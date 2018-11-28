require('../documents/org');
let mongoose = require('mongoose');
let Org = mongoose.model('Org');
let config = require('../../config');

let selection = function (args) {
    let selectArguments = args.orgId ? { orgId: args.orgId } : { org: args.org };

    return selectArguments;
};

module.exports = {
    create: function (args, done) {
        const doc = {
            orgId: args.orgId,
            org: args.org,
            gist: args.gist,
            token: args.token,
            excludePattern: args.excludePattern,
            sharedGist: !!args.sharedGist,
            minFileChanges: args.minFileChanges,
            minCodeChanges: args.minCodeChanges
        };
        if (config.server.github.adminToken) {
            delete doc.token;
        }
        Org.create(doc, function (err, org) {
            done(err, org);
        });
    },

    get: function (args, done) {
        Org.findOne(selection(args), function (err, org) {
            if (!err && !org) {
                err = 'Organization not found in Database';
            }
            if (org && config.server.github.adminToken) {
                org.token = config.server.github.adminToken;
            }
            done(err, org);
        });
    },

    getMultiple: function (args, done) {
        this._find({ orgId: { $in: args.orgId } }, done);
    },

    getOrgWithSharedGist: function (gist, done) {
        this._find({ gist: gist, sharedGist: true }, done);
    },

    remove: function (args, done) {
        Org.findOneAndRemove(selection(args), done);
    },

    _find: (query, done) => {
        Org.find(query, (err, orgs) => {
            if (err) return done(err);
            done(null, orgs.map(org => {
                if (config.server.github.adminToken) {
                    org.token = config.server.github.adminToken;
                }
                return org;
            }));
        });
    }
};
