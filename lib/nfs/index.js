// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var assert = require('assert-plus');
var nfs = require('nfs');

var auth = require('../auth');

var access = require('./access');
var fsinfo = require('./fsinfo');
var fsstat = require('./fsstat');
var getattr = require('./getattr');
var link = require('./link');
var lookup = require('./lookup');
var mkdir = require('./mkdir');
var mknod = require('./mknod');
var pathconf = require('./pathconf');
var read = require('./read');
var readdir = require('./readdir');
var readdirplus = require('./readdirplus');
var readlink = require('./readlink');
var remove = require('./remove');
var rename = require('./rename');
var rmdir = require('./rmdir');
var setattr = require('./setattr');
var symlink = require('./symlink');



///--- API

function createNfsServer(opts) {
    assert.object(opts, 'options');
    assert.object(opts.log, 'options.log');
    assert.object(opts.manta, 'options.manta');
    assert.object(opts.fs, 'options.fs');
    assert.string(opts.cachepath, 'options.cachepath');

    var s = nfs.createNfsServer({
        log: opts.log
    });


    s.use(auth.authorize);
    s.use(function setup(req, res, next) {
        req.manta = opts.manta;
        req.fs = opts.fs;
        req.cachepath = opts.cachepath;	// needed for fsstat
        next();
    });

    s.access(access());
    s.fsinfo(fsinfo());
    s.fsstat(fsstat());
    s.getattr(getattr());
    s.link(link());
    s.lookup(lookup());
    s.mkdir(mkdir());
    s.mknod(mknod());
    s.pathconf(pathconf());
    s.read(read());
    s.readdir(readdir());
    s.readdirplus(readdirplus());
    s.readlink(readlink());
    s.remove(remove());
    s.rename(rename());
    s.rmdir(rmdir());
    s.setattr(setattr());
    s.symlink(symlink());

    s.on('after', function (name, call, reply, err) {
        opts.log.info({
            procedure: name,
            rpc_call: call,
            rpc_reply: reply,
            err: err
        }, 'nfsd: %s handled', name);
    });

    return (s);
}



///--- Exports

module.exports = {
    createNfsServer: createNfsServer
};
