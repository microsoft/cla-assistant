// //api
// var github_api = require('../api/github');

// services
var url = require('../services/url');
var github = require('../services/github');
var logger = require('../services/logger');

var log = function (err, res, args) {
    if (err) {
        logger.warn(new Error(err));
    }
    logger.info('Error: ', err, '; result: ', res, '; Args: ', args);
};

var getPR = function (args, cb) {
    github.call({
        obj: 'pullRequests',
        fun: 'get',
        arg: {
            owner: args.owner,
            repo: args.repo,
            number: args.number,
            noCache: true
        },
        token: args.token
    }, cb);
};

var getStatuses = function (args, done) {
    github.call({
        obj: 'repos',
        fun: 'getStatuses',
        arg: {
            owner: args.owner,
            repo: args.repo,
            ref: args.sha,
            noCache: true
        },
        token: args.token
    }, done);
};

var getCombinedStatus = function (args, done) {
    github.call({
        obj: 'repos',
        fun: 'getCombinedStatusForRef',
        arg: {
            owner: args.owner,
            repo: args.repo,
            ref: args.sha,
            noCache: true
        },
        token: args.token
    }, done);
};

var createStatus = function (args, context, description, state, target_url, done) {
    github.call({
        obj: 'repos',
        fun: 'createStatus',
        arg: {
            owner: args.owner,
            repo: args.repo,
            sha: args.sha,
            state: state,
            description: description,
            target_url: target_url,
            context: context,
            noCache: true
        },
        token: args.token
    }, function (error, response) {
        if (error) {
            logger.warn('Error on Create Status, possible cause - wrong token, saved token does not have enough rights: ');
            log(error, response, args);
        }
        if (typeof done === 'function') {
            done(error, response);
        }
    });
};

var findStatusToBeChanged = function (args, done) {
    getStatuses(args, function (error, response) {
        var statuses = '';
        var description = args.signed ? 'All CLA requirements met.' : 'Contributor License Agreement is not signed yet.';

        var status = {
            context: 'license/cla',
            description: description,
            state: args.signed ? 'success' : 'pending',
            target_url: url.claURL(args.owner, args.repo, args.number)
        };
        try {
            statuses = JSON.parse(response);
        } catch (error) {
            statuses = response;
        }
        var statString = JSON.stringify(statuses);
        if (statString.includes('licence/cla') && status.state == 'success') { // temporary fix if both contexts are there
            var shouldBeChanged = false;
            statuses.some(function findClaStatusToChange(s) {
                if (s.context.match(/licence\/cla/g)) {
                    shouldBeChanged = s.state === 'pending';
                    return true;
                }
            });
            if (shouldBeChanged) {
                createStatus(args, 'licence/cla', status.description, status.state, status.target_url);
            }
        }
        if (statuses) {
            statuses.some(function findClaStatusToChange(s) {
                if (s.context.match(/license\/cla/g)) {
                    status = s.state !== status.state ? status : undefined;
                    return true;
                }
            });
        }

        done(status);
    });
};

var findClaStatus = function (args, done) {
    getCombinedStatus(args, function (err, resp) {
        if (err) {
            return done(err);
        }
        var claStatus = null;
        resp.statuses.some(function (status) {
            if (status.context.match(/license\/cla/g)) {
                claStatus = status;
                return true;
            }
        });
        return done(null, claStatus);
    });
};

var updateStatus = function (args, done) {
    findStatusToBeChanged(args, function (status) {
        if (!status) {
            if (typeof done === 'function') {
                done();
            }
            return;
        }
        createStatus(args, status.context, status.description, status.state, status.target_url, done);
    });
};

var getPullRequestHeadShaIfNeeded = function (args, done) {
    if (args.sha) {
        return done(null, args);
    }
    getPR(args, function (err, resp) {
        if (!resp || !resp.head) {
            err = new Error('Cannot get pull request head.');
        }
        args.sha = resp.head.sha;
        done(err, args);
    });
};

var doneIfNeeded = function (done, err, result) {
    if (typeof done === 'function') {
        return done(err, result);
    }
};

var updateStatusIfNeeded = function (args, status, allowAbsent, done) {
    if (!status) {
        return doneIfNeeded(done, new Error('Status is required for updateStatusIfNeeded.'));
    }
    getPullRequestHeadShaIfNeeded(args, function (err, argsWithSha) {
        if (err) {
            log(err, argsWithSha, args);
            return doneIfNeeded(done, err);
        }
        findClaStatus(args, function (err, claStatus) {
            if (err) {
                return doneIfNeeded(done, err);
            }
            if (!claStatus && allowAbsent) {
                return doneIfNeeded(done, null);
            }
            if (!claStatus || claStatus.state !== status.state || claStatus.description !== status.description || claStatus.target_url !== status.target_url) {
                return createStatus(argsWithSha, status.context, status.description, status.state, status.target_url, done);
            }
            doneIfNeeded(done);
        });
    });
};

module.exports = {
    update: function (args, done) {
        if (args && !args.sha) {
            getPR(args, function (err, resp) {
                if (!err && resp && resp.head) {
                    args.sha = resp.head.sha;
                    updateStatus(args, done);
                } else {
                    if (typeof done === 'function') {
                        done(err);
                    }
                }
            });
        } else if (args) {
            updateStatus(args, done);
        }
    },

    updateForNullCla: function (args, done) {
        var status = {
            context: 'license/cla',
            state: 'success',
            description: 'No Contributor License Agreement required.',
            target_url: null
        };
        updateStatusIfNeeded(args, status, true, done);
    },

    updateForClaNotRequired: function (args, done) {
        var status = {
            context: 'license/cla',
            state: 'success',
            description: 'All CLA requirements met.',
            target_url: null
        };
        updateStatusIfNeeded(args, status, false, done);
    }
};