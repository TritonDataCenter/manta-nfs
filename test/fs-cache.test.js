// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var crypto = require('crypto');
var fs = require('fs');

var bunyan = require('bunyan');
var levelup = require('levelup');
var libuuid = require('libuuid');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var vasync = require('vasync');

var app = require('../lib');

require('nodeunit-plus');



///--- Helpers

function rand(max) {
    return (Math.max(1, Math.floor(Math.random() * max)));
}



///-- Tests

before(function (cb) {
    var self = this;

    this.count = parseInt((process.env.FS_CACHE_COUNT || 100), 10);
    this.expiration = parseInt((process.env.FS_CACHE_EXPIRATION || 100), 10);
    this.size = parseInt((process.env.FS_CACHE_SIZE || (1024 * 10)), 10);

    this.test_dir = '/tmp/manta_nfs_test/' + libuuid.create();
    this.test_dir_cache = this.test_dir + '/cache';
    mkdirp(this.test_dir_cache, function (err) {
        if (err) {
            cb(err);
            return;
        }
        self.db = levelup(self.test_dir + '/' + libuuid.create(), {
            valueEncoding: 'json'
        });
        self.db.once('ready', function () {
            self.cache = app.createFsCache({
                count: self.count,
                expiration: self.expiration,
                db: self.db,
                location: self.test_dir_cache,
                log: bunyan.createLogger({
                    name: 'FsCacheTest',
                    stream: process.stdout,
                    level: process.env.LOG_LEVEL || 'warn',
                    src: true,
                    serializers: bunyan.stdSerializers
                }),
                size: self.size
            });

            self.cache.on('error', function (async_err) {
                self.async_error = async_err;
            });

            self.cache.once('ready', cb);
        });
    });
});


after(function (cb) {
    var self = this;
    this.cache.once('close', function () {
        self.db.close(function (err) {
            rimraf('/tmp/manta_nfs_test', function (err2) {
                cb(err2 || err || self.async_error);
            });
        });
    });
    this.cache.close();
});


test('write, with evictions based on count', function (t) {
    var barrier = vasync.barrier();
    var cache = this.cache;
    var self = this;

    barrier.once('drain', function () {
        t.equal(cache.files, cache.max_files);
        fs.readdir(self.test_dir_cache, function (err, files) {
            t.ifError(err);
            t.equal(files.length, self.count);
            t.end();
        });
    });

    function write(num) {
        var msg = 'hello, world: ' + num;
        var name = libuuid.create();
        barrier.start(name);

        t.doesNotThrow(function () {
            var writer = cache.createWriteStream(name, {
                size: Buffer.byteLength(msg)
            });
            writer.on('error', function (err) {
                t.ifError(err);
                barrier.done(name);
            });

            writer.on('flush', barrier.done.bind(barrier, name));
            writer.end(msg);
        });
    }

    for (var i = 0; i < (this.count * 2); i++)
        write(i);
});


test('write, with evictions based on size', function (t) {
    var barrier = vasync.barrier();
    var cache = this.cache;
    var self = this;
    var total = 0;

    barrier.once('drain', function () {
        fs.readdir(self.test_dir_cache, function (err, files) {
            t.ifError(err);
            t.ok(files.length);

            t.ok(cache.size < cache.max);
            var b2 = vasync.barrier();
            var sz = 0;

            b2.once('drain', function () {
                t.equal(sz, cache.size);
                t.end();
            });

            files.forEach(function (f) {
                b2.start(f);
                fs.stat(self.test_dir_cache + '/' + f, function (err2, stats) {
                    t.ifError(err2);
                    sz += stats.size;
                    b2.done(f);
                });
            });
        });
    });

    (function write() {
        var sz = rand(cache.max);
        var msg = crypto.pseudoRandomBytes(sz);
        var name = libuuid.create();
        barrier.start(name);
        total += sz;

        var writer = cache.createWriteStream(name, {
            size: msg.length
        });

        writer.on('error', function (err) {
            t.ifError(err);
            barrier.done(name);
        });

        writer.on('flush', function () {
            if (total < (cache.max * 10))
                write();

            barrier.done(name);
        });
        writer.end(msg);
    })();
});


test('write (size > max)', function (t) {
    var cache = this.cache;
    var data = crypto.pseudoRandomBytes(this.cache.max * 10);
    var writer = cache.createWriteStream(libuuid.create(), {
        size: data.length
    });

    t.ok(writer);

    writer.once('flush', function () {
        t.equal(cache.files, 0);
        t.equal(cache.size, 0);
        t.end();
    });

    writer.end(data);
});


test('concurrent write error', function (t) {
    var cache = this.cache;
    var data = crypto.pseudoRandomBytes(100);
    var name = libuuid.create();
    var writer = cache.createWriteStream(name, {
        size: data.length
    });

    t.ok(writer);

    writer.once('flush', function () {
        t.equal(cache.files, 1);
        t.equal(cache.size, data.length);
        t.end();
    });

    writer.write(data, function () {
        t.ok(cache.pending(name));
        t.throws(function () {
            cache.createWriteStream(name, {size: 0});
        }, app.WriteInProgressError);
        writer.end();
    });
});


test('read ok', function (t) {
    var cache = this.cache;
    var data = crypto.pseudoRandomBytes(100);
    var name = libuuid.create();
    var writer = cache.createWriteStream(name, {
        size: data.length
    });

    writer.once('flush', function () {
        t.ok(cache.has(name));
        var reader = cache.createReadStream(name);
        t.ok(reader);

        var b;
        reader.on('data', function (chunk) {
            b = b ? Buffer.concat([b, chunk]) : chunk;
        });

        reader.once('end', function () {
            t.ok(b);
            t.equal(b.length, data.length);
            for (var i = 0; i < b.length; i++)
                t.equal(b[i], data[i]);
            t.end();
        });
    });

    writer.end(data);
});


test('read expired not ok (1s lag)', function (t) {
    var cache = this.cache;
    var data = crypto.pseudoRandomBytes(100);
    var name = libuuid.create();
    var writer = cache.createWriteStream(name, {
        size: data.length,
        ttl: 1
    });

    writer.once('flush', function () {
        setTimeout(function () {
            t.notOk(cache.has(name));
            var reader = cache.createReadStream(name);
            t.ok(reader);

            reader.on('error', function (err) {
                t.ok(err);
                t.end();
            });
        }, 1100);
    });

    writer.end(data);
});


test('read concurrent ok', function (t) {
    var cache = this.cache;
    var data = crypto.pseudoRandomBytes(100);
    var name = libuuid.create();
    var writer = cache.createWriteStream(name, {
        size: data.length
    });

    writer.once('flush', function () {
        t.ok(cache.has(name));

        var barrier = vasync.barrier();
        var b1;
        var b2;
        var reader1 = cache.createReadStream(name);
        var reader2 = cache.createReadStream(name);

        t.ok(reader1);
        t.ok(reader2);

        barrier.once('drain', t.end.bind(t));
        barrier.start('one');
        barrier.start('two');

        reader1.on('data', function (chunk) {
            b1 = b1 ? Buffer.concat([b1, chunk]) : chunk;
        });

        reader2.on('data', function (chunk) {
            b2 = b2 ? Buffer.concat([b2, chunk]) : chunk;
        });

        reader1.once('end', function () {
            t.ok(b1);
            t.equal(b1.length, data.length);
            for (var i = 0; i < b1.length; i++)
                t.equal(b1[i], data[i]);
            barrier.done('one');
        });

        reader2.once('end', function () {
            t.ok(b2);
            t.equal(b2.length, data.length);
            for (var i = 0; i < b2.length; i++)
                t.equal(b2[i], data[i]);
            barrier.done('two');
        });
    });

    writer.end(data);
});


test('read throws on ENOENT', function (t) {
    var cache = this.cache;
    var name = libuuid.create();

    t.notOk(cache.has(name));
    var reader = cache.createReadStream(name);
    reader.once('error', function (err) {
        t.ok(err);
        t.ok(err instanceof app.FileNotCachedError);
        t.end();
    });
});


test('mkdir', function (t) {
    var cache = this.cache;
    var name = libuuid.create();

    var stream = cache.mkdir(name);
    stream.once('error', function (err) {
        t.ifError(err);
        t.end();
    });

    stream.once('flush', t.end.bind(t));
    stream.end();
});


test('readdir', function (t) {
    var cache = this.cache;
    var name = libuuid.create();

    var stream = cache.mkdir(name);
    stream.once('error', function (err) {
        t.ifError(err);
        t.end();
    });

    stream.once('flush', function () {
        cache.readdir(name, function (err, files) {
            t.ifError(err);
            t.ok(files);
            t.equal(files.length, 100);
            t.end();
        });
    });

    // stub out what manta looks like
    for (var i = 0; i < 100; i++) {
        var n = '' + i;
        stream.write(JSON.stringify({name: n}) + '\n');
    }

    stream.end();
});
