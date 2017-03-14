import gaze       from 'gaze';
import readline   from 'readline';

/**
 * Returns `keepAlive` set to true so the event / plugin system stays alive while file watching is enabled for the
 * configured source globs that continues to incrementally generate documentation.
 *
 * @param {PluginEvent} ev - The plugin event.
 */
export function onComplete(ev)
{
   ev.data.keepAlive = true;

   const eventbus = ev.eventbus;

   const config = eventbus.triggerSync('tjsdoc:data:config:get');

   const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '[32mTJSDoc>[0m '
   });

   let sourceWatcher, testWatcher;
   let watcherCloseFunction;
   let promptVisible = false;

   if (config._sourceGlobs)
   {
      eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching source globs: ${
       JSON.stringify(config._sourceGlobs)}`);

      // Watch all source files.
      gaze(config._sourceGlobs, { debounceDelay: 500 }, (err, watcher) =>
      {
         sourceWatcher = watcher;

         // On file changed
         sourceWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `changed: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'source', filePath });
         });

         // On file added
         sourceWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `addition: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'source', filePath });
         });

         // On file deleted
         sourceWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `deletion: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'source', filePath });
         });

         sourceWatcher.on('end', () =>
         {
            if (typeof watcherCloseFunction === 'function')
            {
               const closeFunction = watcherCloseFunction;
               watcherCloseFunction = void 0;
               setImmediate(closeFunction);
            }
         });

         // Get watched files with relative paths
         const files = sourceWatcher.relative();

         eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching source files: ${JSON.stringify(files)}`);
      });
   }

   if (config.test && config.test._sourceGlobs)
   {
      eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching test globs: ${
       JSON.stringify(config.test._sourceGlobs)}`);

      // Watch all test files.
      gaze(config.test._sourceGlobs, { debounceDelay: 500 }, (err, watcher) =>
      {
         testWatcher = watcher;

         // On file changed
         testWatcher.on('changed', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `changed: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:changed', { type: 'source', filePath });
         });

         // On file added
         testWatcher.on('added', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `addition: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:added', { type: 'source', filePath });
         });

         // On file deleted
         testWatcher.on('deleted', (filePath) =>
         {
            if (promptVisible) { eventbus.trigger('log:info:raw', ''); }

            eventbus.trigger('log:info:time', `deletion: ${filePath}`);
            eventbus.trigger('tjsdoc:system:watcher:file:deleted', { type: 'source', filePath });
         });

         testWatcher.on('end', () =>
         {
            if (typeof watcherCloseFunction === 'function' && sourceWatcher)
            {
               sourceWatcher.close();
            }
         });

         // Get watched files with relative paths
         const files = testWatcher.relative();

         eventbus.trigger('log:info:time', `tjsdoc-plugin-watcher - watching test files: ${JSON.stringify(files)}`);
      });
   }

   if (config._sourceGlobs || (config.test && config.test._sourceGlobs))
   {
      process.on('SIGINT', () =>
      {
         eventbus.trigger('log:warn:time', 'Received SIGINT. Shutting down.');

         if (rl) { rl.close(); }
         if (sourceWatcher) { sourceWatcher.close(); }
         if (testWatcher) { testWatcher.close(); }

         setImmediate(() => process.exit(0));
      });

      // Set terminal readline loop waiting for the user to type in the commands: `restart` or `exit`.

      rl.on('line', (line) =>
      {
         switch (line.trim())
         {
            case 'exit':
               promptVisible = false;

               rl.close();
               if (sourceWatcher) { sourceWatcher.close(); }
               if (testWatcher) { testWatcher.close(); }

               eventbus.trigger('tjsdoc:system:watcher:stopped');

               process.removeAllListeners('SIGINT');

               setImmediate(() => process.exit(0));
               break;

            case 'globs':
               promptVisible = false;

               if (config._sourceGlobs)
               {
                  eventbus.trigger('log:info:time', `watching source globs: ${JSON.stringify(config._sourceGlobs)}`);
               }

               if (config.test && config.test._sourceGlobs)
               {
                  eventbus.trigger('log:info:time', `watching test globs: ${JSON.stringify(config.test._sourceGlobs)}`);
               }
               break;

            case 'regen':
            case 'regenerate':
               promptVisible = false;

               setImmediate(() =>
               {
                  watcherCloseFunction = () =>
                  {
                     eventbus.trigger('tjsdoc:system:watcher:stopped');
                     eventbus.trigger('tjsdoc:system:regenerate:all:docs');
                  };

                  process.removeAllListeners('SIGINT');

                  // If `testWatcher` exists it will close `sourceWatcher` otherwise
                  if (testWatcher)
                  {
                     testWatcher.close();
                  }
                  else if (sourceWatcher)
                  {
                     sourceWatcher.close();
                  }

                  rl.close();
               });
               break;

            case 'watching':
               promptVisible = false;

               if (sourceWatcher)
               {
                  eventbus.trigger('log:info:time', `watching source files: ${JSON.stringify(sourceWatcher.relative())}`);
               }

               if (testWatcher)
               {
                  eventbus.trigger('log:info:time', `watching test files: ${JSON.stringify(testWatcher.relative())}`);
               }
               break;

            default:
               promptVisible = true;
               rl.prompt();
               break;
         }
      });

      eventbus.trigger('tjsdoc:system:watcher:started');
   }
   else
   {
      eventbus.trigger('log:info:time', 'tjsdoc-plugin-watcher: no main source or tests to watch.');
   }
}
