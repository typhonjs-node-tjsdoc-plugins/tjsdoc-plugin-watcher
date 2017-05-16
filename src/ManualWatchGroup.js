import chokidar   from 'chokidar';
import nodePath   from 'path';

/**
 * Provides a wrapper around chokidar for file watching specifically for the manual files. In the watcher callbacks the
 * file path is matched with its corresponding manual section and this is added to the event callback. Initialization
 * returns a promise which is fulfilled when the watcher is ready.
 */
export default class ManualWatchGroup
{
   /**
    * Instantiate WatchGroup.
    *
    * @param {Watcher}     watcherHost - The host Watcher instance.
    *
    * @param {object}      manualGlobs - An object hash of globs to watch.
    * @property {string[]} manualGlobs.all - All globs / files in a single array.
    * @property {object}   manualGlobs.sections - An object hash of globs / files separated by manual section.
    *
    * @param {string}      type - The file type being watched.
    *
    * @param {boolean}     [onlyChanges=false] - If true only changes to files initially watched are tracked.
    */
   constructor(watcherHost, manualGlobs, type, onlyChanges = false)
   {
      this._watcherHost = watcherHost;
      this._globs = manualGlobs.all;
      this._type = type;
      this._onlyChanges = onlyChanges;

      // Create a reverse lookup hash for file path to manual section.
      this._reverseLookup = Object.keys(manualGlobs.sections).reduce((previous, key) =>
      {
         if (Array.isArray(manualGlobs.sections[key]))
         {
            // Strip any leading relative path as chokidar doesn't include it in callbacks.
            for (const path of manualGlobs.sections[key]) { previous[nodePath.normalize(path)] = key; }
         }
         return previous;
      }, {});
   }

   /**
    * Closes the chokidar watcher instance.
    */
   close()
   {
      this._watcher.close();
      this._watcher = void 0;
   }

   /**
    * Gets the current watched data.
    * @returns {{}}
    */
   getWatched()
   {
      return this._watcher ? this._watcher.getWatched() : {};
   }

   /**
    * Initializes chokidar for file watching and returns a promise which is resolved when the watcher is ready. The
    * result is an object indexed by type with the glob and watcher data.
    *
    * @param {object}   [chokidarOptions={}] - Any chokidar options taken from plugin options.
    * @param {function} [ignoreFunction=undefined] - An optional function which defines chokidar ignore functionality.
    *
    * @returns {Promise}
    */
   initialize(chokidarOptions = {}, ignoreFunction = void 0)
   {
      // Create watcher providing a custom ignored function if defined which uses config._includes and config._excludes
      // for filtering files.
      this._watcher = chokidar.watch(this._globs, Object.assign(typeof ignoreFunction === 'function' ?
       { ignored: ignoreFunction } : {}, chokidarOptions));

      return new Promise((resolve, reject) =>
      {
         // Add error handler to reject promise.
         this._watcher.on('error', (error) => reject(error));

         // On source watcher ready.
         this._watcher.on('ready', () =>
         {
            // On source file changed.
            this._watcher.on('change', (path) =>
            {
               this._watcherHost.logVerbose(`tjsdoc-plugin-watcher - ${this._type} changed: ${path}`);

               const section = this._reverseLookup[path] || 'unknown';

               this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                { action: 'file:change', type: this._type, path, section, options: this._watcherHost.getOptions() });
            });

            if (!this._onlyChanges)
            {
               // On source file added.
               this._watcher.on('add', (path) =>
               {
                  this._watcherHost.logVerbose(`tjsdoc-plugin-watcher - ${this._type} addition: ${path}`);

                  const section = this._reverseLookup[path] || 'unknown';

                  this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                   { action: 'file:add', type: this._type, path, section, options: this._watcherHost.getOptions() });
               });

               // On source file deleted.
               this._watcher.on('unlink', (path) =>
               {
                  this._watcherHost.logVerbose(`tjsdoc-plugin-watcher - ${this._type} unlinked: ${path}`);

                  const section = this._reverseLookup[path] || 'unknown';

                  this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                   { action: 'file:unlink', type: this._type, path, section, options: this._watcherHost.getOptions() });
               });
            }

            // Set watcher start data (globs / files).
            const watchStartData = {};

            watchStartData[this._type] = { globs: this._globs, files: this._watcher.getWatched() };

            resolve(watchStartData);
         });
      });
   }
}
