# 🐜🤖 BugBot
*(from [Message.io](https://message.io/home))*

The printer is out of toner! No worries, with BugBot you just fill out a simple chat conversation that converts into a ticket for your company’s helpdesk platform.

BugBot is an intelligent, human-like bot that can help anyone report, view, comment on, and generally manage bugs through a natural conversational interface.

![Photo credit: Chris Traganos](https://cdn.glitch.com/97da0c25-cb78-4fa8-bc73-82994fe8867e%2FMessage.io-Cisco-Spark-BugBot-1.png?1498324263642)

BugBot responds well to natural language, thanks to [API.AI](https://api.ai/). You can just let it know that you’ve got a problem, you’d like to view information about various bugs, or you can subscribe/unsubscribe from any currently reported bugs.

![Photo credit: Chris Traganos](https://cdn.glitch.com/97da0c25-cb78-4fa8-bc73-82994fe8867e%2FMessage.io-Cisco-Spark-BugBot-2.png?1498324264340)

It comes with a full bug-tracking system in-built so you get started with using BugBot for your organization immediately.

![Photo credit: Chris Traganos](https://cdn.glitch.com/97da0c25-cb78-4fa8-bc73-82994fe8867e%2FMessage.io-Cisco-Spark-BugBot-3.png?1498324264192)
(Don't want to use the in-built bug-tracking system but still want to use the conversation interface? Read **Using other bug tracking systems** below).

## Setup
 1. Remix this project on Glitch by clicking here:
    [![Remix on Glitch](https://cdn.glitch.com/2703baf2-b643-4da7-ab91-7ee2a2d00b5b%2Fremix-button.svg)](https://glitch.com/edit/#!/remix/bugbot-messageio)
 1. Make an app on [developer.ciscospark.com](https://developer.ciscospark.com/).
     1. Login to [developer.ciscospark.com/add-bot.html](https://developer.ciscospark.com/add-bot.html).
     1. Fill out the display name, user name, and icon of the bot.
 1. Make an agent on [console.api.ai](https://console.api.ai/).
 1. Set up your `.env` file.
    1. Set `PUBLIC_URL` to the URL of this remixed Glitch project.
    1. Copy the Access Token from you Cisco Spark bot into `CISCOSPARK_ACCESS_TOKEN`
    1. Generate a random string of characters for `CISCOSPARK_SECRET`. This field is only used to authenticate responses from Cisco Spark and can be set to anything you want, as long as it is secret.
    1. Set `APIAI_ACCESS_TOKEN` to the Client Access Token from API.AI.
    1. If this project is a demo that is open to the public, you may want to set `ALLOW_LIST_ALL_BUGS` to false. Setting this variable to false will disable users from seeing all the bugs available, which is useful if you don't want other users seeing some rudely-titled bug someone else posted.
 1. Use our pre-made API.AI training data (or train API.AI yourself).
     1. Grab our API.AI training data from [here](https://cdn.glitch.com/97da0c25-cb78-4fa8-bc73-82994fe8867e%2FBugBot.zip?1497894600754).
     1. Go to your API.AI agent's settings page.
     1. Click on the "Export and Import" tab.
     1. Click on "Restore from zip".
     1. Upload our training data zip.
 1. You're all set! Go ahead and start talking to your newly created bot on Cisco Spark and watch the magic.

## Using other bug tracking/help desk systems
BugBot is very adaptable.

You can use BugBot's intutive conversational interface with your organization's professional bug tracker very easily, provided that the bug tracker you want to use exposes an API that can be accessed in some way via JavaScript in Node.js. (For example, [Redmine](http://www.redmine.org/) exposes a REST API, which can be accessed through JavaScript. Other systems will likely some interface that can be adapted for use).

 1. First, you can safely remove `bug-tracker/bug-tracker.js` and everything under `views/bug-tracker/` from the project if you don't plan on using the built-in bug tracking system.
 1. Look at `server.js` to get an idea of how a `ciscosparkChatbot` is instantiated and interacts with other components.
 1. Second, make sure you set the `bugTracker` option of the `ciscosparkChatbot` to an object that follows this structure:
    ```javascript
    {
      bugIdLength: /* Regex length specifier of the identifiers used for a bug. (Set to "0," if there is no fixed length). */,
      bugs: {
        get: function(id) {
          // Return a bug object with the given identifier.
        },
        has: function(id) {
          // Return true if there exists a bug with the given identifer, false otherwise.
        },
        set: function(id, bug) {
          // Add a bug identified by "id" and bug object "bug" to the tracker.
        },
        forEach: function(iterationCallback) {
          // Call iterationCallback(id, bug) for each bug being tracked, where "id" is the bug identifier and "bug" is the bug object representing the bug.
        }
      },
      bugTitleToBugIdMap: /* Map of bug titles to arrays of bug identifers with that title. */
    }
    ```
    Bug objects should follow this structure:
    ```javascript
    {
      id: /* Identifier of a the bug. */,
      title: /* Title of the bug */,
      description: /* Bug description. */,
      urgency: /* Urgency: one of "high", "medium", or "low". */,
      open: /* Boolean representing whether the bug is open or not. */,
      reportedBy: {
        name: /* Name of reporter. */,
        personId: /* Optional Cisco Spark personId of the reporter. */
        personEmail: /* Optional Cisco Spark personEmail of the reporter. */
      },
      comments: [
        {
          // First comment
          author: {
            name: /* Name of author. */,
            personId: /* Optional Cisco Spark personId of the author. */
            personEmail: /* Optional Cisco Spark personEmail of the author. */
          },
          body: /* Body text of the comment. */,
          date: /* Date the comment was made, as a Date object. */
        },
        {
          // Second comment
          author: {
            name: /* Name of author. */,
            personId: /* Optional Cisco Spark personId of the author. */
            personEmail: /* Optional Cisco Spark personEmail of the author. */
          },
          body: /* Body text of the comment. */,
          date: /* Date the comment was made, as a Date object. */
        },
        // ...
      ],
      subscribedUsers: [
        {
          name: /* Name of subcriber. */,
          personId: /* Optional Cisco Spark personId of the subscriber. */
          personEmail: /* Optional Cisco Spark personEmail of the subscriber. */
        },
        {
          name: /* Name of subcriber. */,
          personId: /* Optional Cisco Spark personId of the subscriber. */
          personEmail: /* Optional Cisco Spark personEmail of the subscriber. */
        },
        // ...
      ]
    }
    ```
 3. Third, make sure you call the `notifyComment`, `notifyClosed`, and `notifyDeleted` callbacks of the `ciscosparkChatbot` whenever a bug has been commented on, closed, or deleted from your own backend.
 4. You're all set!

## The code
Feel free to look through the code and the comments and adapt it to your own needs or build your own bot with it. The inline comments in `ciscospark-chatbot.js` are quite descriptive and can help you understand how the chatbot works and how to adapt it.
 * `bug-tracker/`
    * `bug-tracker.js`
      
      This is the code for routing and serving requests for the web view of the in-built bug tracker using Express.
 * `ciscospark-chatbot/`
    * `ciscospark-chatbot.js`
      
      This is the bulk of the chatbot code. It includes. The inline comments will help guide you.
    * `phrases.json`
      
      When BugBot says a phrase to the user, it doesn't just output the same string every time.
      Instead, it composes sentences on the fly from lists of phrases that mean the same thing.
      This map is stored in `phrases.json`.
    * `speech.js`
      
      This file includes a few helper functions for working with the phrases from `phrases.json`.
 * `server.js`
   
   This is the entry point of the application.
   It requires all other modules and ties together everything.
 * `public`
   
   CSS for styling the Bootstrap web view for the bug tracker.
 * `views`
   
   Templated HTML pages for the homepage and web views of BugBot. Intended for use with the [EJS template engine](http://www.embeddedjs.com/).

## Tech stack
The following is a list of great tools we used to rapidly develop this chatbot in under a week:
 * [Bootstrap](http://getbootstrap.com/)
 * [Glitch](https://glitch.com/)
 * [API.AI](https://api.ai/)
 * [Botkit Core Library](https://github.com/howdyai/botkit#botkit-core-library)
