// istanbul ignore file

"use strict";

var github = require('./github');
var approve = require('./approve');
var labelModel = require("./label-model");
var isProcessed = require("./is-processed");

var cssEditors = ['fantasai', 'frivoal', 'tabatkins'];

function isExpeditedCss(metadata) {
    return cssEditors.includes(metadata.author.login) &&
        metadata.filenames.every(function(filename) {
            return /^css\//.test(filename);
        });
}

/**
 * Handles any actions that require commenting on the input issue or pull
 * request, based on the given metadata. This includes:
 *
 *   - Approving the PR, if it is a browser-export or is by a CSSWG editor.
 *   - Setting an assignee on the PR (to review it).
 *   - Assigning a set of reviewers to the PR (acting both as a cc functionality
 *     as well as a larger pool of reviewers if the assignee doesn't act).
 *   - Commenting to instruct the author what to do if a reviewer cannot be
 *     found (e.g. if there is no applicable META.yml file with owners in it).
 */
module.exports = async function(number, metadata, dryRun) {
    // Auto-approve PR that have been reviewed downstream.
    if (metadata.reviewedDownstream) {
        const message = 'The review process for this patch is being conducted in the ' +
            metadata.reviewedDownstream + ' project.';
        if (dryRun) {
            console.log(`[DRY-RUN] Would approve PR ${number} with message: ${message}`);
            return true;
        }

        return approve(number, message);
    }


    if (isExpeditedCss(metadata)) {
        const message = '[Peer review is not required for CSS editors.]' +
            '(https://www.w3.org/2018/10/22-css-minutes.html#item20)';
        if (dryRun) {
            console.log(`[DRY-RUN] Would approve PR ${number} with message: ${message}`);
            return true;
        }

        return approve(number, message);
    }

    if (metadata.missingAssignee) {
        if (dryRun) {
            console.log(`[DRY-RUN] Would add assignee ${metadata.missingAssignee} to PR ${number}`);
        } else {
            const body = { assignees: [metadata.missingAssignee] };
            await github.patch('/repos/:owner/:repo/issues/:number', body, { number: number });
        }
    }

    // if there are collaborators, we ask them for a review
    if (metadata.reviewersExcludingAuthor.length > 0 || metadata.isRoot) {
        if (metadata.missingReviewers.length > 0) {
            const label = "status:needs-collaborator";
            const message = "No reviewer on this pull request has write-access to the repository.";
            if (dryRun) {
                console.log(`[DRY-RUN] Would add reviewers ${metadata.missingReviewers} to PR ${number}`);
                // Assume that adding reviewers would have succeeded.
                if (!metadata.isMergeable) {
                    console.log(`[DRY-RUN] Would add label "${label}" and comment "${message}" to PR ${number}`);
                }
                return true;
            }

            // Assign the reviewers.
            const body = { reviewers: metadata.missingReviewers };
            await github.post('/repos/:owner/:repo/pulls/:number/requested_reviewers', body, { number: number });

            // Comment + label if no reviewers have access.
            if (!metadata.isMergeable) {
                return labelAndComment(number, label, message);
            }
            return true;
        }

        if (metadata.isMergeable) {
            // PR has reviewers, and they have write-access to the repo.
            return true;
        }

        // PR has reviewers, but nobody has write-access to the repo.
        const label = "status:needs-collaborator";
        const message = "No reviewer on this pull request has write-access to the repository.";
        if (dryRun) {
            console.log(`[DRY-RUN] Would add label "${label}" and comment "${message}" to PR ${number}`);
            return true;
        }
        return labelAndComment(number, label, message);
    }

    if (metadata.author.isOwner) {
        const label = "status:needs-reviewers";
        const message = "There are no reviewers for this pull request besides its author.";
        if (dryRun) {
            console.log(`[DRY-RUN] Would add label "${label}" and comment "${message}" to PR ${number}`);
            return true;
        }
        return labelAndComment(number, label, message);
    }

    const label = "status:needs-reviewers";
    const message = "There are no reviewers for this pull request.";
    if (dryRun) {
        console.log(`[DRY-RUN] Would add label "${label}" and comment "${message}" to PR ${number}`);
        return true;
    }
    return labelAndComment(number, label, message);
};

async function labelAndComment(number, label, msg) {
    msg += " Please reach out on W3C's irc server (irc.w3.org, port 6665) on channel #testing ([web client](http://irc.w3.org/?channels=testing)) to get help with this. Thank you!";
    await labelModel.post(number, [label], /*dryRun*/ false);

    // Make sure we have not already commented on this PR.
    const processed = await isProcessed(number);
    if (!processed) {
        return github.post('/repos/:owner/:repo/issues/:number/comments', { body: msg }, { number: number });
    }
}
