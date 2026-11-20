# System Bootstrapper CLI

You build it. You own it.

The CLI shares the platform's typed operation services. It does not start an HTTP
server. Use the CLI version distributed with your accepted System release.

```sh
system-bootstrapper --help
system-bootstrapper --version
```

Displaying help, the version or the welcome banner requires no installation
configuration, network connection or host tools and changes no platform state.

Storage operations require the installation's explicit persistence and Seed
selectors, native Docker tools and the accepted controller image. Prepare these
inputs using the host instructions before maintenance. A missing backup medium or
an incompatible image fails closed; it never creates a replacement Seed on the
system disk. See the repository handbook for the complete installation, backup
and recovery procedures.

The public package contains compiled operation code and its required validation
assets. It has no install-time scripts. Builds and publication run in GitLab;
GitHub provides the public source and accepted release documentation.
