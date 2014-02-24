# manta-nfs

`manta-nfs` implements a [NFS vers. 3](http://tools.ietf.org/html/rfc1813)
server which uses
[Joyent Manta](http://www.joyent.com/products/manta) as the backing store.
The server implements all NFS functionality, although some OS-level commands,
such as 'chmod', will have no effect since Manta does not support that concept.
The server is implemented in [node.js](http://nodejs.org/) and **requires**
v0.10.x.

## Overview

The server is a process which runs locally (i.e. on your laptop, in your
zone or on your standalone system) and services NFS requests. The server then
acts as a gateway for those requests back into Manta. Manta objects are
cached locally in the machine's file system so that all NFS operations can
be supported. Unlike Manta, the server provides the typical POSIX write
semantics via its use of the local object cache.

The server cannot run on a system which is already acting as a NFS server
since there would be a conflict on the required ports.
In this case, the server will detect the existing server and exit.

The server includes a built-in portmapper but it will also interoperate
transparently with the system's portmapper (usually rpcbind) if one is running.
The server also includes a built-in mountd and nfsd. There is no lockd provided
by the server.

By default, the server will only listen on the localhost address and only
serve files locally. However, it can be configured to serve files to
external hosts.

Because the server caches Manta objects locally, care must be taken when
accessing Manta in different ways or from different locations. There is no
attempt to be coherent across multiple systems. Given this, you should
not run more than one instance of the server for the same Manta user. Likewise,
you should not write to the same object using both NFS and the CLI. Reading
objects using both NFS and the CLI is obviously fine. If you write an object
using one mechanism (e.g. NFS) and immediately read it using another (e.g. the
CLI) then you may not see the same data. The server will hold an object locally
for a period of time before writing it back to Manta. Likewise, if you update
an existing object using the CLI, the server might have a stale copy in its
cache. In this case you can wait for the server to notice the object has
changed or force the server to refresh its cached copy by simply 'touch'ing the
file.

## Getting Started

Clone the repo then run `npm install` within the clone to build all of the
dependencies. The 'Configuration' section of this readme describes how to
configure the server before you can run it. The 'Usage' section of this
readme describes how to start the server and how to perform an NFS mount.

## Configuration

At a minimum the server needs the configuration information necessary to
connect to a Manta account. If the Manta
[environment variables](http://apidocs.joyent.com/manta/#setting-up-your-environment)
are already setup, the server will use those and no other configuration is
needed.

In addition to the Manta account information, there is a variety of other
configuration options. An example configuration file, showing all possible
configuration options, is provided in `etc/example.json`, although that file
should not be used to create your personal configuration. A simpler
`etc/template.json` file is provided as a better starting point for your
personal configuration. Each section of the configuration file is optional.
The configuration file is specified to the server via the '-f' option. e.g.

    node server.js -f etc/myconfig.json

Although most of the sections in the example config file should be
self-explanatory, here is some additional information.

  * The `manta` section must be used to specify the required access information
    for Manta if the environment variables are not set. The configuration
    information takes precedence over the environment variables if both are
    set.

  * The `database` section can be used to configure where and how the server
    will cache local copies of the Manta objects. The location, size of the
    cache, the time-to-live, writeback delay time and number of parallel
    writebacks for the cache can be set in this section.

    The default cache is under '/var/tmp/mfsdb' with a size limit of 5GB of
    local disk space. The time-to-live is the number of seconds a file will be
    cached before checking to see if it is stale. The default is twelve hours
    (43200 seconds). The writeback time is the number of seconds a dirty file
    will be cached before being written back to Manta. The default is one
    minute (60 seconds). If files are updated regularly (e.g. log files) then
    it might make sense to increase the timeout to reduce writeback traffic,
    but this also increases the window in which data only exists in the local
    cache. The number of parallel writebacks defaults to 2. That is, if there
    are multiple dirty files to writeback, two at a time will be written back.

    The cache size is not a hard limit. It is possible for more space to
    be used than is configured. For example, if an object is larger than the
    cache size, then if that object is pulled into the cache, the whole object
    must be downloaded and the space used by the object will be consumed. This
    would also force all of the other objects out of the cache, since the space
    used exceeds the size limit. Another example is with dirty files. These
    cannot be evicted from the cache until they have been uploaded back to
    Manta, so the cache space used can exceed the size limit until the objects
    have been completely uploaded.

  * The `mount` section's `address` field can be used to specify an address
    other than localhost for the server to listen on. Using '0.0.0.0' tells the
    server to listen on all addresses. Both the mountd and nfsd within the
    server will listen on the given address. Since the server has full access
    to all of the user's Manta data, it is a good idea to limit foreign host
    access when listening on the external network. The `hosts_allow` or
    `hosts_deny` sections can be used to restrict access to the given IP
    addresses. The `exports` section can also be used to restrict access to
    the specified portions of the Manta filesystem.

  * The `nfs` section can be used to set the `uid` and `gid` values for
    'nobody'. This is useful if NFS clients are running a different OS, which
    uses different values for 'nobody', as compared to the server (e.g. Darwin
    vs.  Linux). Over NFS all files will appear to be owned by 'nobody' since
    there is no mechanism to map a Manta username to a local uid on the various
    clients, but within Manta all files continue to be owned by the user
    account. The `fd-cache` section can be used to configure the server's file
    descriptor cache, although this is normally not necessary.

## Usage

When running the server for the first time, you probably want to run it by
hand to confirm that the configuration is correct and things are working as
expected. Once you know things are working correctly, you may want to setup
a service so that the server runs automatically.

The server must be started as root, since it needs access to the portmapper's
privileged port, but once the server is running, it lowers its uid to 'nobody'
to improve security. The 'sudo' or 'pfexec' commands are typically used to run
a command as root, depending on which OS you're using.

If you're using the Manta environment variables as the source of your Manta
account information, and if you're using 'sudo', use the '-E' option to pass
those forward. On some Linux distributions sudo will reset 'HOME' to root's
home directory. On those distributions you must also set HOME back to your home
directory.

On Darwin or Linux, the server can be run with no config file like:

    sudo -E HOME=/home/foo node server.js

On SmartOS, the server can be run like:

    pfexec node server.js

To pass in a config file, use the -f option:

    sudo node server.js -f etc/myconfig.json

All output logging is done via bunyan. Once started, the server will output an
occasional log message, but the '-d' or '-v' option can be used to change the
bunyan logging level to either 'debug' or 'trace'. Logging at either of these
levels is not recommended, except during debugging, since there will be many
log entries for each NFS operation. You may want to redirect the output from
the server into a file:

    sudo node server.js -d -f etc/myconfig.json >log 2>&1

To mount a Manta directory, the standard NFS client mount command is used with
a Manta path. The user name used here must be the same user as is configured
for Manta access. For example, if Manta user 'foo' is configured, then to
mount their 'public' directory:

    sudo mount 127.0.0.1:/foo/public /mnt

Once you have confirmed that the server works as expected, you can setup a
service on your system so that the server runs automatically when the system
boots. Setting up a service like this is OS-specific and is discussed in that
section for each operating system.

## Limitations

There are certain NFS operations which cannot be supported because Manta
itself does not support the underlying concept. These are:

  * Changing the owner uid or gid of a file
  * Changing the mtime or atime of a file
  * Changing or setting the mode of a file
  * Creating a file exclusively (O_EXCL - will happen only in the cache)
  * Making devices, sockets or FIFOs
  * Renaming or moving directories
  * Symlinks and hardlinks

## OS Specific Considerations

This section discusses any issues that are specific to running the server on
a given operating system.


### Darwin

There is normally no portmapper running on Darwin so the server runs with it's
built-in portmapper.

The uid/gid for 'nobody' is -2.

Because you cannot rename a directory, creating new folders using `finder` is
problematic. The new folder will initially be created by finder with the name
`untitled folder`, but you will not be able to rename it. Instead, you must use
a terminal window and the command line to create directories with the correct
name.


The `svc/launchd/com.joyent.mantanfs.plist` file provides an example configuration for
launchd(8). If necessary, edit the file and provide the correct paths to 'node',
'server.js' and your configuration file.

Note that this configuration will bring the service up only if an interface other than lo
has an IPV4/IPV6 address.  However the reverse is not true, and launchd will not bring
down the service if the network goes away.

Run the following to load and start the service:

    sudo cp svc/launchd/com.joyent.mantanfs.plist /System/Library/LaunchDaemons/
    sudo launchctl load /System/Library/LaunchDaemons/com.joyent.mantanfs.plist


### Linux

Some distributions (e.g. Ubuntu or Centos) may not come pre-installed with
the `/sbin/mount.nfs` command which is needed to perform a mount, while others
(e.g. Fedora) may be ready to go. On Ubuntu, install the `nfs-common` package.

    apt-get install nfs-common

On Centos, install the `nfs-utils` package.

    yum install nfs-utils

Installing these packages usually also causes 'rpcbind' to be installed and
started. However, due to a mis-design in the Linux rpcbind code, the server
will not be able to register with the system's rpcbind. There are two options
to workaround this:

  * Disable the system's rpcbind and let the server use its built-in
    portmapper. The method for disabling the system's rpcbind varies depending
    on the service manager that the system uses. If 'rpcbind' is in a seperate
    package from '/sbin/mount.nfs', then you could simply uninstall that
    package. To disable 'rpcbind' on Ubuntu you can run: `stop portmap`.

  * Run the system's rpcbind in 'insecure' mode using the -i option. Again,
    the location for specifying additional options for a service varies by
    distribution. On systems using 'upstart' you can add the option in
    `/etc/init/portmap.conf`. On systems using 'systemd' you can add the
    option in `/etc/sysconfig/rpcbind`. On systems which use traditional
    rc files you must edit `/etc/init.d/rpcbind` and add the option to the
    invocation of rpcbind in the script.

On Linux the uid/gid for 'nobody' is 65534.

There is no lock manager included in the server, so you must disable locking
when you mount. e.g.

    mount -o nolock 127.0.0.1:/foo.bar/public /home/foo/mnt

To setup the server as a service, so that it runs automatically when the
system boots, you need to hook into the system's service manager. Linux offers
a variety of dfferent service managers, depending upon the distribution.

  * rc files

    The traditional Unix rc file mechanism is not really a service manager but
    it does provide a way to start or stop services when the system is booting
    or shutting down.

    The `svc/rc/mantanfs` file is a shell script which will start up the server.
    Make a copy of this file into `/etc/init.d`. If necessary, edit the file and
    provide the correct paths to 'node', 'server.js' and your configuration
    file.

    Symlink the following names to the 'mantanfs' file:

        ln -s /etc/rc3.d/S90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc4.d/S90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc5.d/S90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc0.d/K90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc1.d/K90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc2.d/K90mantanfs -> ../init.d/mantanfs
        ln -s /etc/rc6.d/K90mantanfs -> ../init.d/mantanfs

    The script directs the server log to '/var/log/mantanfs.log'.

  * Systemd

    See this [wiki](https://fedoraproject.org/wiki/Systemd) for more details
    on configuring and using systemd.  Also see the `systemd.unit(5)` and
    `systemd.service(5)` man pages.

    The `svc/systemd/mantanfs.service` file provides an example configuration
    for systemd. Make a copy of this file into /lib/systemd/system. If
    necessary, edit the file and provide the correct paths to 'node',
    'server.js' and your configuration file.

    Run the following to start the service:

        systemctl start mantanfs.service

    Since systemd has its own logging, you must use the 'journalctl' command to
    look at the logs.

        journalctl _SYSTEMD_UNIT=mantanfs.service

  * Upstart

    See this [cookbook](http://upstart.ubuntu.com/cookbook/) for more details
    on configuring and using upstart.

    The `svc/upstart/mantanfs.conf` file provides an example configuration for
    upstart. Make a copy of this file into /etc/init. If necessary, edit the
    file and provide the correct paths to 'node', 'server.js' and your
    configuration file.

    Run the following to start the service:

        initctl start mantanfs

    The server log should be available as '/var/log/upstart/mantanfs.log'.

### SmartOS

In order to mount from the local host, the system's 'rpcbind' must be running.
The built-in portmapper cannot be used. If the svc is not already enabled,
enable it.

    svcadm enable network/rpc/bind

Due to a mis-design in the SmartOS mount code, mounting will fail on older
platforms. If you see the following, you know your mount code is incorrect.

    nfs mount: 127.0.0.1: : RPC: Program not registered
    nfs mount: retrying: /home/foo.bar/mnt

You will either need to run on a newer platform or you can use this 
[fixed NFS mount command](http://us-east.manta.joyent.com/jjelinek/public/mount)
explicitly. e.g.

    pfexec ./mount 127.0.0.1:/foo.bar/public /home/foo/mnt

For unmounting, you can use this
[fixed umount command](http://us-east.manta.joyent.com/jjelinek/public/umount)
explicitly.

On SmartOS the uid/gid for 'nobody' is 60001.

The `svc/smf/manta-nfs.xml` file provides an example configuration for
smf(5). If necessary, edit the file and provide the correct paths to 'node',
'server.js' and your configuration file.

Run the following to load and start the service:

    svccfg -v import svc/smf/manta-nfs.xml

### Windows

[instructions coming soon]
