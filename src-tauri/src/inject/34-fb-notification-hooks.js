// Messenger raises full desktop notifications (sender, text, picture, a tag
// per message) only when it believes it runs as an installed app that is out
// of sight. This app is that app, and it counts as away whenever its window
// does not have focus, which also covers every account whose tab is hidden.
//
// Only the two checks that decide this change (a rewrite of one module's
// source, see fbModules): patching VisibilityAPI or isMessengerPWA themselves
// would change far more of the page.
fbModules.rewrite('useMWLSChatPopperUpper', [
  [/(\w+)\("VisibilityAPI"\)\.isVisibilityHidden\(\)===!0/, '($1("VisibilityAPI").isVisibilityHidden()===!0||!document.hasFocus())'],
  [/\w+\("isMessengerPWA"\)\(\)&&\w+\("justknobx"\)\._\("1465"\)/, '!0'],
]);

// What the page knows about each message it is about to notify about, by
// message id (the notification's tag), read when it hands the message over.
const notificationHooks = (() => {
  const details = new Map();
  fbModules.patch('MWDesktopNotifications', (exports) => {
    const trigger = exports.triggerLocalNotification;
    if (typeof trigger !== 'function') return false;
    exports.triggerLocalNotification = function (db, message, ...rest) {
      const notify = () => {
        details.set(String(message?.messageId), fbData.messageDetails(db, message).catch(() => null));
        if (details.size > 50) details.delete(details.keys().next().value);
        return trigger.call(this, db, message, ...rest);
      };
      return fbData.isOldNews(db, message).then((old) => (old ? undefined : notify()), notify);
    };
    return true;
  });
  return {
    // Whether Messenger now raises its own notifications while away.
    active: () => fbModules.state('useMWLSChatPopperUpper') === 'rewritten',
    details: (tag) => details.get(String(tag)) ?? Promise.resolve(null),
  };
})();
