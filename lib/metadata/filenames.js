"use strict";
var github = require('../github');

module.exports = function(issue) {
    return github.get("/repos/:owner/:repo/pulls/:number/files", { number: issue })
        .then(function(files) {
            return {
                all: files.map((file) => file.filename),
                ignoreRemoved: files.filter((file) => file.status != 'removed').map((file) => file.filename)
            };
        });
};

