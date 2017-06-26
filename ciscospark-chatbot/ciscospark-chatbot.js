var apiaiService = require("apiai");
var botkit = require("botkit");
var botkitMiddlewareApiai = require("botkit-middleware-apiai");
var uuidV1 = require("uuid/v1");

var speech = require("./speech");

/**
 * This maps a Cisco Spark's personId to any conversation that they currently have ongoing with the bot.
 * It is used so that a previous conversation can be interrupted and stopped when a new push notification comes in.
 */
var personIdToPrivateConversationMap = {};

/**
 * Main exported function that starts up the chatbot.
 */
module.exports = function(options) {
  var module = {};
  
  // Give Botkit authorization info about the bot.
  var controller = botkit.sparkbot({
    log: options.log,
    public_address: options.publicUrl,
    ciscospark_access_token: options.ciscospark.accessToken,
    secret: options.ciscospark.secret
  });
  
  // Here, two interfaces to API.AI are brought up:
  //  - One that directly uses the API.AI npm package.
  //  - One that uses uses API.AI indirectly through the pre-made botkit-middleware-apiai package.
  // The direct API.AI is necessary because later, we need to set the incoming API.AI context of a message manually later on.
  // In all other cases, we use the pre-made botkit-middleware-apiai that was specifically made for Botkit to automatically process messages through API.AI.
  // Generate a session ID that will be shared between the two interfaces.
  var apiaiSessionId = uuidV1();
  // Start up the direct API.AI service.
  var apiai = apiaiService(options.apiai.accessToken);
  // Start up the indirect API.AI middleware.
  var apiaiMiddleware = botkitMiddlewareApiai({
    token: options.apiai.accessToken,
    // Don't send messages that the bot produced to API.AI because that would be silly.
    skip_bot: true,
    // Make it share the same session ID as the direct interface
    sessionId: apiaiSessionId
  });
  // Tell Botkit to use the API.AI middleware we just brought up.
  controller.middleware.receive.use(function(bot, message, next) {
    // But first, preprocess the text a little.
    if ("text" in message) {
      // Remove @mentions to BugBot.
      message.text = message.text.replace(/\bBugBot /g, "").replace(/ BugBot\b/g, "").replace(/\bBugBot\b/g, "").trim();
    }
    
    // Then, pass it on to the middleware.
    apiaiMiddleware.receive(bot, message, next);
  });
  
  var bot = controller.spawn({
  });
  
  // The callback that is used with all conversation.ask() calls so that the user can quit at any time.
  var quitCallback = {
    pattern: /^\/quit$/i,
    callback: function(response, conversation) {
      conversation.say(speech.get("ok") + " " +
                       speech.get("sorry to see you go"));
      conversation.say(speech.get("bye"));
      // conversation.next will have no more queued up events to execute after this point and will kill the conversation.
      conversation.next();
    }
  };
  
  // Helper function that converts a string with \n in it to one that Cisco Spark displays as a mulit-line blockquote.
  function multilineToQuote(multiline, prefix) {
    var returnValue = "";
    var first = true;
    multiline.split("\n").forEach(function(line) {
      if (!first) {
        returnValue += "\n\n";
      } else {
        first = false;
      }
      returnValue += prefix + "> " + line;
    });
    return returnValue;
  }
  
  // Convenience function used to ask the user a question, string together multiple responses into one multiline string, and pass it on the the next function once the user types a message with nothing but "/done".
  // Used in multiple places.
  function collectMultilineResponse(conversation, next) {
    var text = "";
    conversation.ask("*(Type `/done` when you're " +
                     speech.get("done") +
                     ").*",
                     [
      quitCallback,
      {
        pattern: /^\/done$/i,
        callback: function(response, conversation) {
          next(text.trim());
        }
      },
      {
        default: true,
        callback: function(response, conversation) {
          text += response.text;
          text += "\n";
        }
      }
    ]);
  }
  
  // Convenience function used to add a comment to the conversation's current bug and notify any subscribed users about it.
  // Used in multiple places.
  function addComment(conversation, author, text) {
    if (!(text.trim())) {
      // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
      // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
      // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
      // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
      conversation.ask(speech.get("ok") + " " +
                       "Not adding any comments.", [
        quitCallback,
        {
          default: true,
          callback: function(response, conversation) {
            talk(response, conversation);
            conversation.next();
          }
        }
      ]);
      return;
    }
    // Only add the comment if the bug is actually open
    if (conversation.vars.bug.open) {
      var comment = {
        author: author,
        date: new Date(),
        body: text
      }
      conversation.say("Commenting...");
      // Add the comment to the bug
      conversation.vars.bug.comments.push(comment);
      // Notify any subscribed users
      conversation.vars.bug.subscribedUsers.forEach(function(userToNotify) {
        module.notifyComment(userToNotify, comment, conversation.vars.bug);
      });
      // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
      // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
      // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
      // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
      conversation.ask("Done!", [
        quitCallback,
        {
          default: true,
          callback: function(response, conversation) {
            talk(response, conversation);
            conversation.next();
          }
        }
      ]);
    }
  }
  
  // Exported callback that should be called in order to notify a user that a comment has been added on a bug they were subscribed to, either through the web view or through the chatbot itself.
  module.notifyComment = function(userToNotify, comment, bug) {
    if (("personEmail" in comment.author)
        && ("personEmail" in userToNotify)
        && (comment.author.personEmail === userToNotify.personEmail)) {
      // Don't notify the user of the comment if the user is the one who wrote the comment because that would be silly.
      return;
    }
    if ("personEmail" in userToNotify) {
      if (userToNotify.personId in personIdToPrivateConversationMap) {
        // Interrupt and stop any previous private conversation with this user.
        personIdToPrivateConversationMap[userToNotify.personId].stop();
      }
      bot.startPrivateConversation({
        user: userToNotify.personEmail
      }, function(error, conversation) {
        personIdToPrivateConversationMap[userToNotify.personId] = conversation;
        var firstMessage = "";
        if ("personId" in comment.author) {
          // @mention the user if we have their personId (meaning they made this comment with the chatbot).
          firstMessage += "<@personId:" + comment.author.personId + ">";
        } else {
          // The user must have used the web view.
          // Just use the name they provided there.
          firstMessage += comment.author.name;
        }
        firstMessage += " commented on [Bug " + bug.id + "](" + bug.url + "), \"[" + bug.title + "](" + bug.url + ")\":";
        conversation.say(firstMessage);
        conversation.say(multilineToQuote(comment.body, ""));
        conversation.say("*Messages you send now will become replies to this comment.*");
        collectMultilineResponse(conversation, function(text) {
          conversation.vars.bug = bug;
          addComment(conversation, userToNotify, text);
          conversation.next();
        });
      });
    }
  }
  // Exported callback that should be called in order to notify a user that a bug they were subscribed to was closed.
  module.notifyClosed = function(user, bug) {
    if ("personId" in user) {
      if (user.personId in personIdToPrivateConversationMap) {
        // Interrupt and stop any previous private conversation with this user.
        personIdToPrivateConversationMap[user.personId].stop();
      }
      bot.startPrivateConversationWithPersonId(user.personId, function(error, conversation) {
        conversation.say("[Bug " + bug.id + "](" + bug.url + "), \"[" + bug.title + "](" + bug.url + ")\", has been closed.");
      });
    }
  }
  // Exported callback that should be called in order to notify a user that a bug they were subscribed to was deleted.
  module.notifyDeleted = function(user, bug) {
    if ("personId" in user) {
      if (user.personId in personIdToPrivateConversationMap) {
        // Interrupt and stop any previous private conversation with this user.
        personIdToPrivateConversationMap[user.personId].stop();
      }
      bot.startPrivateConversationWithPersonId(user.personId, function(error, conversation) {
        conversation.say("Bug " + bug.id + ", \"" + bug.title + "\", has been deleted.");
      });
    }
  }
  
  // MAIN FUNCTION.
  // This is the entry point to all dialogue between the bot and the user.
  function talk(message, conversation) {
    // Helper function that will re-use any existing context, check if the given message has some information in it that indicates what bug the user is talking about, or ask the user directly what bug they want to perform an action on if there is no context nor something in the message that indicates a bug.
    function promptBug(message, conversation, action, prompt, next) {
      if (!("entities" in message)) {
        // Safeguard in case API.AI couldn't generate the entities at all.
        message.entities = {};
      }
      if (message.entities.title) {
        // Reset any bug from a previous action.
        conversation.vars.bug = {};
        conversation.vars.bug.title = message.entities.title;
        // Start the check and the loop if necessary.
        getBug();
      } else {
        if ("bug" in conversation.vars) {
          // Use the already saved bug from a previous action and keep the context.
          conversation.say("Assuming you want to " +
                           action +
                           " the current bug ([Bug " +
                           conversation.vars.bug.id +
                           "](" +
                           conversation.vars.bug.url +
                           "), \"[" +
                           conversation.vars.bug.title +
                           "](" +
                           conversation.vars.bug.url +
                           ")\")...");
          next();
        } else {
          conversation.vars.bug = {};
          // Start the loop.
          getBug();
        }
      }
      // Helper function that will attempt to match a given bug "title" to the ID of an existing bug, the URL of an existing bug, or the title of an existing bug if the "title" does not match an ID or URL.
      function getBugFromTitle(title) {
        // Try to match to a bug ID using regex.
        var matches = title.match(new RegExp("^([a-z0-9]{" + options.bugTracker.bugIdLength + "})$"));
        if (matches !== null) {
          return options.bugTracker.bugs.get(matches[1]);
        }
        // If we reached here, the "title" did not match a bug ID.
        // Try matching it to a URL.
        matches = title.match(new RegExp("^https?://bugbot-messageio[\. ]glitch[\. ]me/bugs[/ ]([a-z0-9]{" + options.bugTracker.bugIdLength + "})$"));
        if (matches !== null) {
          return options.bugTracker.bugs.get(matches[1]);
        }
        // Neither of the above matched.
        // Try looking for it in the map of bug titles to bugs.
        if (title in options.bugTracker.bugTitleToBugIdMap) {
          var returnValue = new Array(options.bugTracker.bugTitleToBugIdMap[title].length);
          for (var i = 0; i < returnValue.length; i++) {
            returnValue[i] = options.bugTracker.bugs.get(options.bugTracker.bugTitleToBugIdMap[title][i]);
          }
          return returnValue;
        }
        // No bug ID, URL, or title matches the "title" parameter.
        return undefined;
      }
      // Helper function that will keep looping recursively via callbacks until "/quit" is encountered, or getBugFromTitle no longer returns undefined (meaning the bug the user entered has been found).
      function getBug() {
        if (conversation.vars.bug.title) {
          var temp = getBugFromTitle(conversation.vars.bug.title);
          if (!temp) {
            conversation.say(speech.get("sorry") +
                             ", I " +
                             speech.get("did not") +
                             " find a " +
                             speech.get("bug or bug report") +
                             " with an ID, link, or title of \"" +
                             conversation.vars.bug.title +
                             "\" in my database.");
            // The bug with the given title doesn't actually exist.
            // Set it to undefined to trigger the prompt for the bug.
            conversation.vars.bug.title = undefined;
          } else {
            if (Array.isArray(temp)) {
              // TODO Support multiple bugs with the same title
              conversation.vars.bug = temp[0];
            } else {
              conversation.vars.bug = temp;
            }
          }
        }
        if (!conversation.vars.bug.title) {
          conversation.ask(prompt, [
            quitCallback,
            {
              default: true,
              callback: function(response, conversation) {
                conversation.vars.bug.title = response.text;
                // Loop to check if the bug with the given title actually exists.
                getBug();
                conversation.next();
              }
            }
          ]);
          return;
        }
        next();
      }
    }
    
    // Actions to carry out on intents from API.AI.
    var actions = {
      // This is the intent that is triggered when the user says something completely vague like just "BugBot", or gives a blank message.
      prompt: function(message, conversation) {
        conversation.ask(speech.get("how can I help") + ", <@personId:" + message.original_message.personId + ">?", [
          quitCallback,
          {
            default: true,
            callback: function(response, conversation) {
              talk(response, conversation);
              conversation.next();
            }
          }
        ]);
      },
      // API.AI could not classify the user's input with any one of the trained intent specific to BugBot, but it was able to generate a smalltalk message to whatever the user just said, so tell the user whatever API.AI generated as a smalltalk response.
      smalltalk: function(message, conversation) {
        conversation.say(message.nlpResponse.result.fulfillment.speech);
      },
      // API.AI couldn't classify what the user said as any of the commands.
      // We are a bug reporting bot, so do something sane and ask if the user wanted to file a bug report with the title being the message text.
      fallback: function(message, conversation) {
        // Check if it's something like "yes".
        // If it does match, it must have been a response like "ok" to a prompt we didn't need an answer from.
        // (This regex is copied from bot.utterances.yes, but it does not match ^y).
        if (!(new RegExp(/^(yes|yea|yup|yep|ya|sure|ok|yeah|yah)/i).test(message.text))) {
          conversation.ask(speech.capitalizeFirstLetter(speech.get("do you want")) +
                           " to " +
                           speech.get("report a bug") +
                           " titled " +
                           "\"" + message.text + "\"?",
                           [
            quitCallback,
            {
              pattern: bot.utterances.yes,
              callback: function(response, conversation) {
                // actions.report will by default reset any previous context.
                // Suppress this behavior with a flag that actions.report understands.
                conversation.vars.noResetReport = true;
                conversation.vars.bug = {
                  title: message.text
                }
                actions.report(response, conversation);
                conversation.next();
              }
            },
            {
              // Match any "quit-like" or "no-like" messages.
              // (This regex is the combination of bot.utterances.quit and bot.utterances.no).
              pattern: /^(quit|cancel|end|stop|done|exit|nevermind|never mind|no|nah|nope|n)/i,
              callback: function(response, conversation) {
                conversation.say(speech.get("ok") + " " + 
                                 speech.get("bye"));
                conversation.next();
              }
            },
            {
              default: true,
              callback: function(response, conversation) {
                talk(response, conversation);
                conversation.next();
              }
            }
          ]);
        } else {
          conversation.stop();
        }
      },
      // Report a bug.
      report: function(message, conversation) {
        // If some previous action established some context that they want to pass onto actions.report in order to skip some prompts, keep that context.
        if (conversation.vars.noResetReport) {
          // Make sure to reset the context next time.
          conversation.vars.noResetReport = false;
        } else {
          // Reset the context - nobody said not to.
          conversation.vars.bug = {};
        }
        // Check if there are any entities in the first message requesting the report, so that we can avoid being redundant and skip some prompts.
        if ("entities" in message) {
          if (message.entities.title) {
            // A title was recognized. Set context accordingly.
            conversation.vars.bug.title = message.entities.title;
          }
          if (message.entities.urgency) {
            // An urgency was recognized. Set context accordingly.
            conversation.vars.bug.urgency = message.entities.urgency;
          }
        }
        function getTitle() {
          // Check if title already exists in existing context.
          if (!("title" in conversation.vars.bug)) {
            conversation.ask("What " + 
                             speech.get("do you want") +
                             " to title this " +
                             speech.get("bug or bug report") +
                             "?", [
              quitCallback,
              {
                default: true,
                callback: function(response, conversation) {
                  conversation.vars.bug.title = response.text;
                  // Get the urgency next after we get a response from the user.
                  getUrgency();
                  conversation.next();
                }
              }
            ]);
          } else {
            // Title is already known, move on directly to getting the urgency.
            getUrgency();
          }
        }
        function getUrgency() {
          // Don't get the urgency if it is already set in the context.
          if (!("urgency" in conversation.vars.bug)) {
            conversation.ask("How urgent is this " +
                             speech.get("bug or bug report") +
                             "?", [
              quitCallback,
              {
                default: true,
                callback: function(response, conversation) {
                  // This is where the direct API.AI interface is used.
                  var request = apiai.textRequest(response.text, {
                    sessionId: apiaiSessionId,
                    contexts: [
                      {
                        // Set the API.AI context so that API.AI only matches the message with the urgency entity.
                        // Note that this is not the built-in behaviour of API.AI and is only possible by messing around with the input contexts and priority on urgencies.
                        // See the "urgency" intent in the API.AI exported data provided through the README
                        name: "urgency-only",
                        lifespan: 1
                      }
                    ]
                  });
                  request.on("response", function(response) {
                    // API.AI couldn't match it to an urgency.
                    // Re-prompt.
                    if (!response.result.parameters.urgency) {
                      conversation.say(speech.get("sorry") +
                                       ", I " +
                                       speech.get("did not") + " " +
                                       speech.get("understand") +
                                       " that.");
                      conversation.repeat();
                    } else {
                      conversation.vars.bug.urgency = response.result.parameters.urgency;
                      getDescription();
                    }
                    conversation.next();
                  });
                  request.on("error", function(error) {
                    conversation.next(error);
                  });
                  request.end();
                }
              }
            ]);
          } else {
            getDescription();
          }
        }
        // Use collectMutlilineResponse to get a multi-line-enabled description of the bug from the user.
        function getDescription() {
          if (!("description" in conversation.vars.bug)) {
            conversation.vars.bug.description = "";
            conversation.say(speech.get("describe bug"));
            collectMultilineResponse(conversation, function(text) {
              conversation.vars.bug.description = text;
              doReport();
            });
          }
        }
        // Take all the information set in the context so far, add any remaining fields in the bug report, and commit the bug report the the bug tracker's storage
        function doReport() {
          controller.api.people.get(message.original_message.personId).then(function(identity) {
            var me = {
              name: identity.displayName,
              personEmail: message.user,
              personId: message.original_message.personId
            };
            conversation.say(speech.get("creating") +
                             " a " +
                             conversation.vars.bug.urgency +
                             " urgency bug report titled \"" +
                             conversation.vars.bug.title + "\"...");
            conversation.vars.bug.id = options.bugTracker.newBugId();
            conversation.vars.bug.url = options.bugTracker.getBugUrl(conversation.vars.bug.id);
            conversation.vars.bug.open = true;
            conversation.vars.bug.dateOpened = new Date();
            conversation.vars.bug.comments = [];
            options.bugTracker.bugs.set(conversation.vars.bug.id, conversation.vars.bug);
            if (!(conversation.vars.bug.title in options.bugTracker.bugTitleToBugIdMap)) {
              options.bugTracker.bugTitleToBugIdMap[conversation.vars.bug.title] = [];
            }
            options.bugTracker.bugTitleToBugIdMap[conversation.vars.bug.title].push(conversation.vars.bug.id);
            conversation.say("Subscribing you to any changes...");
            conversation.vars.bug.subscribedUsers = [me];
            conversation.vars.bug.reportedBy = me;
            // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
            // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
            // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
            // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
            conversation.ask("Here's a link to your newly created bug: [Bug " + conversation.vars.bug.id + "](" + conversation.vars.bug.url + ").", [
              quitCallback,
              {
                default: true,
                callback: function(response, conversation) {
                  talk(response, conversation);
                  conversation.next();
                }
              }
            ]);
            conversation.next();
          });
        }
        
        // Start the chain.
        getTitle();
      },
      help: function(message, conversation) {
        conversation.say("I can help you file, view, and stay up-to-date with bug reports very easily.");
        conversation.say("Here's a full list of everything that I can help you with:");
        // Don't do this in multiple conversation.say events because conversation.say intentionally delays messages by at least 1 second between each message (so it feels like the bot is talking).
        // However, the 1 second delay would take too long to print this many lines.
        conversation.say(" - Reporting a new bug\n\n" +
                         " - Viewing information about an existing bug\n\n" +
                         " - Subscribing to changes to an existing bug\n\n" +
                         " - Unsubscribing to changes to an existing bug\n\n" +
                         (options.allowListAllBugs ? " - Listing all the bugs currently being tracked\n\n" : "") +
                         " - Commenting on an existing bug");
        conversation.say("You can access these functions directly by typing `/report`, `/view`, `/subscribe`, `/unsubscribe`" +
                         (options.allowListAllBugs ? ", `/list` " : " ") +
                        "and `/comment`.");
        conversation.say("However, **don't**.");
        conversation.say("I'm quite intelligent, so feel free to talk to be just as you would with any human. Chances are that I'll understand what you're saying and do the right thing.");
        conversation.say("For example, you can say \"I want to report a very important bug about my computer,\" and I'll know exactly what to do.");
        conversation.say("I can even feel emotions! ❤️");
        conversation.say("So go ahead, try me!");
        conversation.say("*(Note: If at any time, you want to quit talking with me, just type `/quit`).*");
      },
      // Triggered when the user wants to comment on a bug.
      comment: function(message, conversation) {
        // Prompt for the bug or re-use existing context if there is any.
        promptBug(message, conversation, "comment on",
                  "What " +
                  speech.get("bug or bug report") + " " +
                  speech.get("do you want") +
                  " to comment on?",
                  doComment);
        // Collect and commit the comment.
        // Mainly done through the use of helper funcitons above.
        function doComment() {
          controller.api.people.get(message.original_message.personId).then(function(identity) {
            conversation.say("You can type your comment now.");
            collectMultilineResponse(conversation, function(text) {
              addComment(conversation, {
                name: identity.displayName,
                personEmail: message.user,
                personId: message.original_message.personId
              }, text);
              conversation.next();
            });
          });
        }
      },
      // Triggered when the user wants to get information about an existing bug.
      info: function(message, conversation) {
        // Prompt for the bug or re-use existing context if there is any.
        promptBug(message, conversation, "information about",
                  "What " +
                  speech.get("bug or bug report") + " " +
                  speech.get("do you want") +
                  " more information about?",
                  doInfo);
        function doInfo() {
          var string = "";
          string += "[Bug " + conversation.vars.bug.id + "](" + conversation.vars.bug.url + "):\n\n"
          string += " - Title: " + conversation.vars.bug.title + "\n\n";
          string += " - Description:\n\n";
          string += multilineToQuote(conversation.vars.bug.description, "   ") + "\n\n";
          string += " - Status: " + (conversation.vars.bug.open ? "Open" : "Closed") + "\n\n";
          string += " - Urgency: " + speech.capitalizeFirstLetter(conversation.vars.bug.urgency) + "\n\n";
          string += " - Date opened: " + options.formatDate(conversation.vars.bug.dateOpened) + "\n\n";
          // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
          // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
          // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
          // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
          conversation.ask(string, [
            quitCallback,
            {
              default: true,
              callback: function(response, conversation) {
                talk(response, conversation);
                conversation.next();
              }
            }
          ]);
        }
      },
      // Triggered when the user wants to list all currently tracked bugs.
      list: function(message, conversation) {
        if (options.allowListAllBugs) {
          var string = "";
          var first = true;
          options.bugTracker.bugs.forEach(function(bug) {
            if (!first) {
              string += "\n\n";
            } else {
              first = false;
            }
            // Make a bulleted list of links to bugs using the title of the bug as the link text.
            string += " - [" + bug.title + "](" + bug.url + ")";
          });
          conversation.say(speech.get("right now there " + (options.bugTracker.bugs.length === 1 ? "is" : "are")) + " " +
                           options.bugTracker.bugs.length +
                           (options.bugTracker.bugs.length === 1 ? " bug " : " bugs ") +
                           "being tracked" +
                           (options.bugTracker.bugs.length === 0 ? "." : ":"));
          // Kill the conversation and its associated context.
          // It doesn't make sense to keep context about a particular bug if we just finished listing all of the bugs.
          conversation.say(string);
        } else {
          actions.fallback(message, conversation);
        }
      },
      // Triggered when the user wants to subscribe to an existing bug.
      subscribe: function(message, conversation) {
        promptBug(message, conversation, "subscribe to",
                  "What " +
                  speech.get("bug or bug report") + " " +
                  speech.get("do you want") +
                  " to subscribe to?",
                  doSubscribe);
        function doSubscribe() {
          for (var i = 0; i < conversation.vars.bug.subscribedUsers.length; i++) {
            if (conversation.vars.bug.subscribedUsers[i].personId === message.original_message.personId) {
              // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
              // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
              // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
              // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
              conversation.ask("You are already subscribed to this " + speech.get("bug or bug report") + ".", [
                quitCallback,
                {
                  default: true,
                  callback: function(response, conversation) {
                    talk(response, conversation);
                    conversation.next();
                  }
                }
              ]);
              return;
            }
          }
          controller.api.people.get(message.original_message.personId).then(function(identity) {
            conversation.say("Subscribing you to any changes...");
            conversation.vars.bug.subscribedUsers.push({
              name: identity.displayName,
              personEmail: message.user,
              personId: message.original_message.personId
            });
            // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
            // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
            // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
            // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
            conversation.ask("Done!", [
              quitCallback,
              {
                default: true,
                callback: function(response, conversation) {
                  talk(response, conversation);
                  conversation.next();
                }
              }
            ]);
          });
        }
      },
      // Triggered when the user wants to unsubscribe to an existing bug.
      unsubscribe: function(message, conversation) {
        promptBug(message, conversation, "unsubscribe from",
                  "What " +
                  speech.get("bug or bug report") + " " +
                  speech.get("do you want") +
                  " to unsubscribe from?",
                  doUnsubscribe);
        function doUnsubscribe() {
          for (var i = 0; i < conversation.vars.bug.subscribedUsers.length; i++) {
            if (conversation.vars.bug.subscribedUsers[i].personId === message.original_message.personId) {
              conversation.say("Unsubscribing you from any changes...");
              conversation.vars.bug.subscribedUsers.splice(i, 1);
              // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
              // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
              // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
              // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
              conversation.ask("Done!", [
                quitCallback,
                {
                  default: true,
                  callback: function(response, conversation) {
                    talk(response, conversation);
                    conversation.next();
                  }
                }
              ]);
              return;
            }
          }
          // Use conversation.ask instead of conversation.say because conversation.say kills the conversation when there are no more "conversation.say" events queued up.
          // However, we want to keep the conversation alive so that we can keep the context stored in conversation alive as well to use in later actions.
          // Therefore, we use conversation.ask and then pass on any responses to the same processing function that is used for completely new conversations: the talk function.
          // (Botkit will automatically kill any conversation after some timeout time, so there is no memory leak if the user never returns and conversation.ask is kept waiting for a response).
          conversation.ask("You are already unsubscribed from this " + speech.get("bug or bug report") + ".", [
            quitCallback,
            {
              default: true,
              callback: function(response, conversation) {
                talk(response, conversation);
                conversation.next();
              }
            }
          ]);
        }
      }
    }
    
    // Not part of actual bot functionality and only for demonstration purposes.
    // When BugBot receives the /reset command, it prints 50 blank lines to push previous messages off the screen so that it looks like the 1-to-1 Cisco Spark conversation with BugBot is completely new.
    if (message.text === "/reset") {
      var string = "";
      for (var i = 0; i < 50; i++) {
        string += " \n\n";
      }
      conversation.say(string);
      return;
    }
    
    // Figure out what to do next
    if (!message.text) {
      // If it was a blank message, prompt the user for what they want to do.
      message.intent = "prompt";
    } else if (message.nlpResponse.result.action.startsWith("smalltalk")) {
      // If API.AI was able to generate a smalltalk response, use the generated response in actions.smalltalk.
      message.intent = "smalltalk";
    }
    
    if (options.log) {
      console.log("BUGBOT: Intent of \"" + message.text + "\" is " + message.intent + ".");
      console.log("BUGBOT: Entities in \"" + message.text + "\" are " + JSON.stringify(message.entities) + ".");
    }
    
    // Do the actions associated with the API.AI intent that was matched.
    if (message.intent in actions) {
      actions[message.intent](message, conversation);
    }
  }
  
  controller.setupWebserver(options.port, function(error, webserver) {
    controller.createWebhookEndpoints(webserver, bot);
  });
  // Export the webserver so it can be used for the web view using Express later.
  // (Botkit uses Express internally).
  module.webserver = controller.webserver;
  
  // Introduce yourself when you are added to a room.
  controller.on("bot_space_join", function(bot, message) {
    bot.reply(message, speech.get("hi there") +
              " I'm BugBot, from Message.io.\n\n" + 
              "I can help you report and stay up-to-date with bugs quickly and easily.\n\n",
              function(error, newMessage) {
      if (newMessage.roomType == "group") {
        // Let the user know of the Cisco Spark restrictions in place.
        bot.reply(message, "**This is a group room.**\n\n**I will only respond when @mentioned.**");
      } else {
        bot.startConversation(message, function(error, conversation) {
          message.original_message.personId = message.original_message.actorId;
          controller.api.people.get(message.original_message.actorId).then(function(identity) {
            // Set message.user to an email of the user to added BugBot, not BugBot's email.
            message.user = identity.emails[0];
            personIdToPrivateConversationMap[message.original_message.actorId] = conversation;
            talk(message, conversation);
          });
        });
      }
    });
  });
  
  // This happens in a group room, so don't add this conversation to personIdToPrivateConversationMap (this is not a private conversation).
  controller.on("direct_mention", function(bot, message) {
    bot.startConversation(message, function(error, conversation) {
      talk(message, conversation);
    });
  });
  
  // This happens only in a private conversation, so add the conversation that was created to personIdToPrivateConversationMap.
  controller.on("direct_message", function(bot, message) {
    bot.startConversation(message, function(error, conversation) {
      personIdToPrivateConversationMap[message.original_message.personId] = conversation;
      talk(message, conversation);
    });
  });
  
  return module;
}
