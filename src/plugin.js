import gaze from 'gaze';

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

   const config = eventbus.triggerSync('tjsdoc:get:config');

   eventbus.trigger('log:info:raw', `tjsdoc-plugin-watcher - watching source globs: ${
    JSON.stringify(config._sourceGlobs)}`);

   process.on('SIGINT', () =>
   {
      eventbus.trigger('log:warn', 'Received SIGINT. Shutting down.');

      setImmediate(() => process.exit(0));
   });

   // Watch all .js files/dirs in process.cwd()
   gaze(config._sourceGlobs, (err, watcher) =>
   {
      // On file changed
      watcher.on('changed', (filePath) =>
      {
         eventbus.trigger('log:info:raw', `${filePath} was changed`);

         try
         {
            const result = eventbus.triggerSync('tjsdoc:file:generate:doc:data:throw:errors', filePath);

            if (result)
            {
               eventbus.trigger('log:info:raw', `tjsdoc-plugin-watcher - docData: ${JSON.stringify(result.docData)}`);
            }
            else
            {
               eventbus.trigger('log:warn', `Failed to generate doc data for: ${filePath}`);
            }
         }
         catch (err)
         {
            eventbus.trigger('log:warn', `Failed to generate doc data for: ${filePath}`, err);
         }
      });

      // On file added
      watcher.on('added', (filePath) =>
      {
         console.log(`${filePath} was added`);
      });

      // On file deleted
      watcher.on('deleted', (filePath) =>
      {
         console.log(`${filePath} was deleted`);
      });

      // Get watched files with relative paths
      const files = watcher.relative();

      eventbus.trigger('log:info:raw', `tjsdoc-plugin-watcher - watching files: ${JSON.stringify(files)}`);
   });
}
