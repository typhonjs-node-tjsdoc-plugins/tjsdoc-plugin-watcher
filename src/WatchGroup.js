import chokidar   from 'chokidar';

/**
 * Provides a wrapper around chokidar for file watching. Initialization returns a promise which is fulfilled when
 * the watcher is ready.
 */
export default class WatchGroup
{
   /**
    * Instantiate WatchGroup.
    *
    * @param {Watcher}  watcherHost - The host Watcher instance.
    * @param {string[]} globs - An array of globs to watch.
    * @param {string}   type - The file type being watched.
    * @param {boolean}  [onlyChanges=false] - If true only changes to files initially watched are tracked.
    */
   constructor(watcherHost, globs, type, onlyChanges = false)
   {
      this._watcherHost = watcherHost;
      this._globs = globs;
      this._type = type;
      this._onlyChanges = onlyChanges;
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

               this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                { action: 'file:change', type: this._type, path, options: this._watcherHost.getOptions() });
            });

            if (!this._onlyChanges)
            {
               // On source file added.
               this._watcher.on('add', (path) =>
               {
                  this._watcherHost.logVerbose(`tjsdoc-plugin-watcher - ${this._type} addition: ${path}`);

                  this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                   { action: 'file:add', type: this._type, path, options: this._watcherHost.getOptions() });
               });

               // On source file deleted.
               this._watcher.on('unlink', (path) =>
               {
                  this._watcherHost.logVerbose(`tjsdoc-plugin-watcher - ${this._type} unlinked: ${path}`);

                  this._watcherHost.triggerEvent('tjsdoc:system:watcher:update',
                   { action: 'file:unlink', type: this._type, path, options: this._watcherHost.getOptions() });
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
