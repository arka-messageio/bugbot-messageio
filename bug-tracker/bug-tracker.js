var bodyParser = require('body-parser');
var crypto = require("crypto");
var dateFormat = require("dateformat");
var lru = require("lru-cache");

module.exports = function(options) {
  // Object to export
  var module = {};
  
  if (!("max" in options)) {
    // The default cap for the number of bugs in the sample bug tracker is 1000
    options.max = 1000;
  }
  if (!("maxAge" in options)) {
    // The default maximum age to keep bugs for in the sample bug tracker is 1 week
    options.maxAge = 1000 * 60 * 60 * 24 * 7 ; // 1 week in milliseconds
  }
  if ("bugIdLength" in options) {
    module.bugIdLength = options.bugIdLength;
  } else {
    module.bugIdLength = 32;
  }
  if ("formatDate" in options) {
    module.formatDate = options.formatDate;
  } else {
    module.formatDate = function(date) {
      return dateFormat(date, "yyyy-mm-dd h:MM TT Z");
    }
  }
  
  var disposeCallbackPointer = {
    disposeCallback: function(element) {
      // Do nothing - placeholder function
    }
  };
  
  module.bugTitleToBugIdMap = {};
  // In memory store that removes the least recently used elements
  module.bugs = new lru({
    max: options.max,
    maxAge: options.maxAge,
    dispose: function(element) {
      disposeCallbackPointer.disposeCallback(element);
      delete module.bugTitleToBugIdMap[element.title];
    }
  });
  
  module.newBugId = function() {
    return crypto
        .randomBytes(module.bugIdLength / 2) // 2 hex digits per byte, so need to get BUG_ID_LENGTH / 2 bytes to get an ID of length BUG_ID_LENGTH.
        .toString('hex')
        .toLowerCase();
  }
  module.getBugUrl = function(bugId) {
    return options.publicUrl + "/bugs/" + bugId;
  }
  
  module.setupWebserver = function(app, callbacks) {
    app.use(bodyParser.urlencoded({ extended: true }));

    if (options.allowListAllBugs) {
      app.get("/bugs", function(request, response) {
        response.render("bug-tracker/index.ejs", {
          bugs: module.bugs,
          formatDate: module.formatDate
        });
      });
    }
    
    var bugRoute = "/bugs/:id([a-z0-9]{" + module.bugIdLength + "})";
    app.get(bugRoute, function(request, response) {
      if (module.bugs.has(request.params.id)) {
        response.render("bug-tracker/bugs/bugs.ejs", {
          bug: module.bugs.get(request.params.id),
          formatDate: module.formatDate,
          allowListAllBugs: options.allowListAllBugs
        });
      } else {
        response.status(404).render("bug-tracker/bugs/404.ejs", request.params);
      }
    });
    app.post(bugRoute, function(request, response) {
      if (module.bugs.has(request.params.id)) {
        var bug = module.bugs.get(request.params.id);
        if (request.body.action === "comment") {
          // Comment on the bug.
          if (bug.open) {
            // Only comment if it's already open.
            var comment = {
              author: {
                name: request.body.author
              },
              date: new Date(),
              body: request.body.body
            };
            bug.comments.push(comment);
            // Notify subscribers.
            bug.subscribedUsers.forEach(function(userToNotify) {
              callbacks.notifyComment(userToNotify, comment, bug);
            });
          }
          response.redirect(request.url);
        } else if (request.body.action === "close") {
          // Close the bug.
          if (bug.open) {
            // Only close it if it's already open.
            bug.open = false;
            // Notify subscribers.
            bug.subscribedUsers.forEach(function(userToNotify) {
              callbacks.notifyClosed(userToNotify, bug);
            });
            response.redirect(request.url);
          }
        } else if (request.body.action === "delete") {
          // Notify subscribers.
          bug.subscribedUsers.forEach(function(userToNotify) {
            callbacks.notifyDeleted(userToNotify, bug);
          });
          response.render("bug-tracker/bugs/deleted.ejs", bug);
          module.bugs.del(request.params.id);
        }
      } else {
        response.status(404).render("bug-tracker/bugs/404.ejs", request.params);
      }
    });
  }
  
  return module;
}
