var mongoose = require('mongoose');
mongoose.Promise = require('q').Promise;

var RepoSchema = mongoose.Schema({
    repoId: String,
    repo: String,
    owner: String,
    gist: String,
    token: String,
    sharedGist: Boolean,
    minFileChanges: Number,
    minCodeChanges: Number
});

RepoSchema.index({
    repo: 1,
    owner: 1
}, {
    unique: true
});

var Repo = mongoose.model('Repo', RepoSchema);

module.exports = {
    Repo: Repo
};
