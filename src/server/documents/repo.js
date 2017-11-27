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

var index = {
    repoId: 1,
    repo: 1,
    owner: 1
};
var indexOptions = {
    unique: true
};

var Repo = mongoose.model('Repo', RepoSchema);

/**
 *  TODO: Remove this for now because Document DB don't support creating index with this many index properties.
 *        And dropAllIndexes() will exclude any query path, which means almost all queries will not work.
 * */

// Repo.collection.dropAllIndexes(function (err, results) {
//     if (err) {
//         logger.warn('Repo collection dropAllIndexes error: ', err);
//         logger.warn('dropAllIndexes results: ', results);
//     }
// });

// Repo.collection.createIndex(index, indexOptions);

module.exports = {
    Repo: Repo
};