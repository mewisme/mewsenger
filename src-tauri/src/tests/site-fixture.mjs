import { readFileSync } from 'node:fs';

// The bundled profile shipped with the app.
export const site = JSON.parse(readFileSync(new URL('../../site.json', import.meta.url), 'utf8'));

// An alternative profile used to prove scripts follow the config, not constants.
export const facebookSite = {
  start_url: 'https://www.facebook.com/messages/',
  app_hosts: ['facebook.com', 'www.facebook.com'],
  in_app_hosts: [
    {
      domain: 'facebook.com',
      paths: ['/messages', '/messenger_media', '/groupcall', '/videocall', '/login', '/checkpoint', '/dialog', '/connect'],
    },
  ],
  link_shim_hosts: ['l.messenger.com', 'l.facebook.com', 'lm.facebook.com'],
  thread_path: ['messages', 't'],
};
