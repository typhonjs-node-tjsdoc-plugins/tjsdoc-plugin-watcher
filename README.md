# tjsdoc-plugin-watcher
Provides file watching control and event bindings which other plugins may consume.

This plugin alters the control flow of TJSDoc and enables file watching during the `onComplete` callback. TJSDoc does not exit normally as file watching will be ongoing until explicitly ended. Other plugins may respond to update events. For instance `typhonjs-plugin-watcher-doc-regenerate` incremently regenerates documentation incrementally for modified source and test files.
