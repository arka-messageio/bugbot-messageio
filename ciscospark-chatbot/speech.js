/**
 * When BugBot says a phrase to the user, it doesn't just output the same string every time.
 * Instead, it composes sentences on the fly from lists of phrases that mean the same thing.
 * (This map is stored in "phrases.json").
 * 
 * This way, BugBot sounds less mechanical and more human.
 */
var phrases = require("./phrases");

/**
 * Picks a random phrase that is equivalent in meaning, but different in wording to the given phraseKey and returns the result.
 */
exports.get = function(phraseKey) {
  return phrases[phraseKey][Math.floor(Math.random() * phrases[phraseKey].length)];
}

/**
 * Does what it says. Capitalizes the first letter in the given string and returns the result.
 *
 * Used to capitalize some phrases in the phrases map that are lowercase in order to keep correct grammer in the resulting compose d sentences.
 */
exports.capitalizeFirstLetter = function(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
