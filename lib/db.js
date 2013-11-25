// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var events = require('events');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var levelup = require('levelup');
var nfs = require('nfs');



///--- Errors

function error(code, msg) {
    var e = new Error(msg);
    e.code = code;
    return (e);
}



///--- Helpers

function fhandle_key(fhandle) {
    assert.string(fhandle, 'fhandle');

    return ('/fhandles/' + fhandle);
}


function mount_key(p) {
    assert.string(p, 'path');

    return ('/mounts/' + p);
}



///--- API

function Database(opts) {
    assert.object(opts, 'options');
    assert.string(opts.location, 'options.location');
    assert.object(opts.log, 'options.log');
    assert.optionalObject(opts.options, 'options.options');

    events.EventEmitter.call(this, opts);

    var self = this;
    this._location = opts.location;
    this._options = opts.options || {};
    this.db = levelup(this._location, this._options, function (err) {
        if (err) {
            self.emit('error', err);
        } else {
            self.emit('ready');
        }
    });
    this.log = opts.log.child({component: 'Database'}, true);
}
util.inherits(Database, events.EventEmitter);


Database.prototype.save_mount = function save_mount(opts, cb) {
    assert.object(opts, 'options');
    assert.object(opts.config, 'options.config');
    assert.string(opts.fhandle, 'options.fhandle');
    assert.optionalObject(opts.log, 'options.log');
    assert.string(opts.path, 'options.path');
    assert.func(cb, 'callback');

    var mkey = mount_key(opts.path);
    var fkey = fhandle_key(opts.fhandle);
    var log = opts.log || this.log;
    var fval = clone(opts.config);
    var mval = {
        fhandle: fkey,
        mount_time: new Date().getTime()
    };

    fval.fname = opts.path;
    fval.mount = mkey;
    fval.time = new Date().getTime();

    log.debug({
        fhandle_key: fkey,
        mount_key: mkey,
        fhandle_val: fval,
        mount_val: mval
    }, 'db.save_mount(%s): entered', opts.path);

    this.db.batch().put(fkey, fval).put(mkey, mval).write(function (err) {
        if (err) {
            log.debug(err, 'db.save_mount(%s): failed', opts.path);
            cb(error(nfs.MNT3ERR_SERVERFAULT,
                     opts.fhandle + ': ' + err.toString()));
        } else {
            log.debug('db.save_mount(%s): done', opts.path);
            cb(null);
        }
    });
};


Database.prototype.lookup_fhandle = function lookup_fhandle(fhandle, opts, cb) {
    assert.string(fhandle, 'fhandle');
    if (typeof (opts) === 'function') {
        cb = opts;
        opts = {};
    }
    assert.object(opts, 'options');
    assert.optionalObject(opts.log, 'options.log');
    assert.func(cb, 'callback');

    var fkey = fhandle_key(fhandle);
    var log = opts.log || this.log;

    log.debug('db.lookup_fhandle(%s): entered', fhandle);
    this.db.get(fkey, function (err, val) {
        if (err) {
            log.debug(err, 'db.lookup_fhandle(%s): failed', fhandle);
            cb(error(nfs.NFS3ERR_SERVERFAULT, fhandle + ': ' + err.toString()));
        } else if (!val) {
            log.debug('db.lookup_fhandle(%s): returned null', fhandle);
            cb(error(nfs.NFS3ERR_BADHANDLE, fhandle + ': not found'));
        } else if (typeof (val) !== 'object') {
            log.debug({value: val}, 'db.lookup_fhandle(%s): bad data', fhandle);
            cb(error(nfs.NFS3ERR_SERVERFAULT, fhandle + ': corrupt data'));
        } else {
            log.debug({value: val}, 'db.lookup_fhandle(%s): done', fhandle);
            cb(null, val);
        }
    });
};


Database.prototype.toString = function toString() {
    var FMT = '[object Database<location=%s, options=%j>]';
    return (util.format(FMT, this._location, this._options));
};



///--- Exports

module.exports = {
    Database: Database,

        var db new Database(opts);
        db.once('ready')
    }
};
