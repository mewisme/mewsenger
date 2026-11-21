//! Direct Windows toast delivery. `tauri-plugin-notification` cannot remove a
//! delivered toast or carry a text input on Windows, so Messenger toasts that
//! need either go through WinRT here. Other platforms report `unsupported` and
//! callers fall back to the plugin.

use tauri::AppHandle;

#[derive(Clone, Debug, PartialEq)]
pub struct ToastRequest {
    /// `toast-<id>`; at most 64 characters.
    pub tag: String,
    /// `thread-<thread id>` or empty; at most 64 characters.
    pub group: String,
    pub title: String,
    pub body: String,
    pub reply: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToastEvent {
    Opened { tag: String },
    Reply { tag: String, text: String },
    Dismissed { tag: String },
}

pub fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

pub fn build_xml(req: &ToastRequest) -> String {
    let actions = if req.reply {
        r#"<actions><input id="reply" type="text" placeHolderContent="Reply"/><action content="Send" arguments="send" activationType="foreground"/></actions>"#
    } else {
        ""
    };
    format!(
        r#"<toast activationType="foreground" launch="open"><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual><audio src="ms-winsoundevent:Notification.Default"/>{}</toast>"#,
        xml_escape(&req.title),
        xml_escape(&req.body),
        actions
    )
}

/// Tags and groups must fit the 64 character limit of the notification API.
pub fn fits_limits(req: &ToastRequest) -> bool {
    req.tag.chars().count() <= 64 && req.group.chars().count() <= 64
}

#[cfg(windows)]
mod imp {
    use std::{collections::VecDeque, sync::Mutex};

    use tauri::AppHandle;
    use windows::{
        core::{IInspectable, Interface, HSTRING},
        Data::Xml::Dom::XmlDocument,
        Foundation::{IReference, TypedEventHandler},
        UI::Notifications::{
            ToastActivatedEventArgs, ToastDismissedEventArgs, ToastNotification,
            ToastNotificationManager,
        },
    };

    use super::{build_xml, fits_limits, ToastEvent, ToastRequest};

    /// Windows delivers activation only to toast objects that are still alive.
    static ALIVE: Mutex<VecDeque<(String, ToastNotification)>> = Mutex::new(VecDeque::new());

    fn retain(tag: &str, toast: &ToastNotification) {
        if let Ok(mut list) = ALIVE.lock() {
            list.push_back((tag.to_string(), toast.clone()));
            while list.len() > 64 {
                list.pop_front();
            }
        }
    }

    fn release(tag: &str) {
        if let Ok(mut list) = ALIVE.lock() {
            list.retain(|(held, _)| held != tag);
        }
    }

    fn reply_text(args: &ToastActivatedEventArgs) -> Option<String> {
        let input = args.UserInput().ok()?;
        let value = input.Lookup(&HSTRING::from("reply")).ok()?;
        let text = value.cast::<IReference<HSTRING>>().ok()?.Value().ok()?;
        Some(text.to_string_lossy())
    }

    pub fn show(
        app: &AppHandle,
        req: ToastRequest,
        on_event: impl Fn(ToastEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        if !fits_limits(&req) {
            return Err("toast tag or group too long".into());
        }
        let fail = |what: &str, error: windows::core::Error| format!("{what}: {error}");
        let doc = XmlDocument::new().map_err(|e| fail("xml", e))?;
        doc.LoadXml(&HSTRING::from(build_xml(&req)))
            .map_err(|e| fail("xml", e))?;
        let toast =
            ToastNotification::CreateToastNotification(&doc).map_err(|e| fail("toast", e))?;
        toast
            .SetTag(&HSTRING::from(req.tag.as_str()))
            .map_err(|e| fail("tag", e))?;
        if !req.group.is_empty() {
            toast
                .SetGroup(&HSTRING::from(req.group.as_str()))
                .map_err(|e| fail("group", e))?;
        }

        let on_event = std::sync::Arc::new(on_event);
        let tag = req.tag.clone();
        let activated_events = on_event.clone();
        toast
            .Activated(&TypedEventHandler::new(
                move |_: windows::core::Ref<ToastNotification>,
                      args: windows::core::Ref<IInspectable>| {
                    let event = args
                        .as_ref()
                        .and_then(|args| args.cast::<ToastActivatedEventArgs>().ok())
                        .map(|args| {
                            let is_send = args
                                .Arguments()
                                .map(|a| a.to_string_lossy() == "send")
                                .unwrap_or(false);
                            match (is_send, reply_text(&args)) {
                                (true, Some(text)) => ToastEvent::Reply {
                                    tag: tag.clone(),
                                    text,
                                },
                                (true, None) => ToastEvent::Dismissed { tag: tag.clone() },
                                _ => ToastEvent::Opened { tag: tag.clone() },
                            }
                        })
                        .unwrap_or_else(|| ToastEvent::Opened { tag: tag.clone() });
                    release(&tag);
                    activated_events(event);
                    Ok(())
                },
            ))
            .map_err(|e| fail("activated", e))?;
        let tag = req.tag.clone();
        toast
            .Dismissed(&TypedEventHandler::new(
                move |_: windows::core::Ref<ToastNotification>,
                      _: windows::core::Ref<ToastDismissedEventArgs>| {
                    release(&tag);
                    on_event(ToastEvent::Dismissed { tag: tag.clone() });
                    Ok(())
                },
            ))
            .map_err(|e| fail("dismissed", e))?;

        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
            app.config().identifier.as_str(),
        ))
        .map_err(|e| fail("notifier", e))?;
        retain(&req.tag, &toast);
        notifier.Show(&toast).map_err(|e| {
            release(&req.tag);
            fail("show", e)
        })
    }

    pub fn remove_group(app: &AppHandle, group: &str) {
        let result = ToastNotificationManager::History().and_then(|history| {
            history.RemoveGroupWithId(
                &HSTRING::from(group),
                &HSTRING::from(app.config().identifier.as_str()),
            )
        });
        if let Err(error) = result {
            eprintln!("could not remove delivered toasts: {error}");
        }
    }

    pub fn clear_all(app: &AppHandle) {
        let result = ToastNotificationManager::History().and_then(|history| {
            history.ClearWithId(&HSTRING::from(app.config().identifier.as_str()))
        });
        if let Err(error) = result {
            eprintln!("could not clear delivered toasts: {error}");
        }
    }
}

#[cfg(windows)]
pub fn show(
    app: &AppHandle,
    req: ToastRequest,
    on_event: impl Fn(ToastEvent) + Send + Sync + 'static,
) -> Result<(), String> {
    imp::show(app, req, on_event)
}

#[cfg(windows)]
pub fn remove_group(app: &AppHandle, group: &str) {
    imp::remove_group(app, group)
}

#[cfg(windows)]
pub fn clear_all(app: &AppHandle) {
    imp::clear_all(app)
}

#[cfg(not(windows))]
pub fn show(
    _app: &AppHandle,
    _req: ToastRequest,
    _on_event: impl Fn(ToastEvent) + Send + Sync + 'static,
) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(not(windows))]
pub fn remove_group(_app: &AppHandle, _group: &str) {}

#[cfg(not(windows))]
pub fn clear_all(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(reply: bool) -> ToastRequest {
        ToastRequest {
            tag: "toast-7".into(),
            group: "thread-42".into(),
            title: "Alice".into(),
            body: "hi <there> & \"you\"".into(),
            reply,
        }
    }

    #[test]
    fn escapes_the_five_xml_specials() {
        assert_eq!(xml_escape("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&apos;");
    }

    #[test]
    fn plain_toast_has_text_and_sound_but_no_input() {
        let xml = build_xml(&request(false));
        assert_eq!(
            xml,
            "<toast activationType=\"foreground\" launch=\"open\"><visual><binding template=\"ToastGeneric\"><text>Alice</text><text>hi &lt;there&gt; &amp; &quot;you&quot;</text></binding></visual><audio src=\"ms-winsoundevent:Notification.Default\"/></toast>"
        );
        assert!(!xml.contains("<input"));
    }

    #[test]
    fn reply_toast_adds_a_text_box_and_send_button() {
        let xml = build_xml(&request(true));
        assert!(xml.contains(
            "<actions><input id=\"reply\" type=\"text\" placeHolderContent=\"Reply\"/><action content=\"Send\" arguments=\"send\" activationType=\"foreground\"/></actions></toast>"
        ));
    }

    #[test]
    fn message_text_cannot_inject_markup() {
        let mut req = request(false);
        req.title = "</text><actions><action content=\"x\" arguments=\"send\"/>".into();
        let xml = build_xml(&req);
        assert!(!xml.contains("<action content=\"x\""));
        assert_eq!(xml.matches("<text>").count(), 2);
    }

    #[test]
    fn tag_and_group_are_limited_to_64_characters() {
        let mut req = request(false);
        assert!(fits_limits(&req));
        req.group = "g".repeat(65);
        assert!(!fits_limits(&req));
    }
}
