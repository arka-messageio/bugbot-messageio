/**
 * This is the entry point of the application.
 * It requires all other modules and ties together everything.
 */

var express = require("express");

// Set up the 1st stage of the bug tracker.
var bugTracker = require("./bug-tracker/bug-tracker")({
  publicUrl: process.env.PUBLIC_URL,
  allowListAllBugs: (process.env.ALLOW_LIST_ALL_BUGS === "true")
});

// Set up and start the chatbot.
var ciscosparkChatbot = require("./ciscospark-chatbot/ciscospark-chatbot.js")({
  log: true,
  publicUrl: process.env.PUBLIC_URL,
  ciscospark: {
    accessToken: process.env.CISCOSPARK_ACCESS_TOKEN,
    secret: process.env.CISCOSPARK_SECRET
  },
  apiai: {
    accessToken: process.env.APIAI_ACCESS_TOKEN
  },
  bugTracker: bugTracker,
  port: process.env.PORT,
  allowListAllBugs: (process.env.ALLOW_LIST_ALL_BUGS === "true"),
  formatDate: bugTracker.formatDate
});

// Get the Express webserver exported by the chatbot.
var app = ciscosparkChatbot.webserver;

// Set the location for static files and views of the bug tracker.
app.set("views", "./views");
app.use(express.static("public"));

// Re-use the chatbot's Express webserver to also server the web pages for the bug tracker's web views
// Also, hook up the notification callbacks that the chatbot exposes to the bug tracker so that the chatbot can notify the user when a bug they are subscribed to has been commented on, closed, or deleted through the web view.
bugTracker.setupWebserver(app, {
  notifyComment: ciscosparkChatbot.notifyComment,
  notifyClosed: ciscosparkChatbot.notifyClosed,
  notifyDeleted: ciscosparkChatbot.notifyDeleted
});

// Finally, add a route to the home page (which is not related to the actual in-built bug-tracker)
app.get("/", function (request, response) {
  response.render("index.ejs");
});
