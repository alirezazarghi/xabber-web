define("xabber-chats", function () {
  return function (xabber) {
    var env = xabber.env,
        constants = env.constants,
        templates = env.templates.chats,
        utils = env.utils,
        $ = env.$,
        $iq = env.$iq,
        $msg = env.$msg,
        $pres = env.$pres,
        Strophe = env.Strophe,
        _ = env._,
        moment = env.moment,
        uuid = env.uuid,
        Images = utils.images,
        Emoji = utils.emoji;

    xabber.Message = Backbone.Model.extend({
        idAttribute: 'msgid',

        defaults: function () {
            return {
                msgid: uuid(),
                type: 'main',
                state: constants.MSG_PENDING
            };
        },

        initialize: function () {
            var time = this.get('time'), attrs = {};
            if (time) {
                attrs.timestamp = Number(moment(time));
            } else {
                attrs.timestamp = moment.now();
                attrs.time = moment(attrs.timestamp).format();
            }
            this.set(attrs);
        },

        getText: function () {
            var forwarded_message = this.get('forwarded_message');
            if (forwarded_message) {
                return forwarded_message.get('message');
            }
            return this.get('message');
        },

        getState: function () {
            return constants.MSG_STATE[this.get('state')];
        },

        getVerboseState: function () {
            var state = constants.MSG_VERBOSE_STATE[this.get('state')];
            if (!this.collection.account.isOnline()) {
                state = 'Message will be sent when you get online.'
            }
            return state;
        },

        isSenderMe: function () {
            return this.collection.account.get('jid') === this.get('from_jid');
        }
    });

    xabber.Messages = Backbone.Collection.extend({
        model: xabber.Message,
        comparator: 'timestamp',

        initialize: function (models, options) {
            this.account = options.account;
        },

        createFromStanza: function ($message, options) {
            options || (options = {});
            var group_chat = ($message.children('x[xmlns="' + Strophe.NS.GROUP_CHAT + '"]').length) ? $message.children('x[xmlns="' + Strophe.NS.GROUP_CHAT + '"]').first() : undefined,
                $delay = options.delay || $message.children('delay'),
                invite_group_chat = $message.find('invite'),
                full_jid = (invite_group_chat.length) ? (invite_group_chat.attr('jid') || $message.attr('from')) : undefined || ((group_chat) ? (group_chat.find('user jid').text() || group_chat.find('jid').text() || group_chat.find('id').text() || group_chat.find('user').attr('id')) : $message.attr('from')) || options.from_jid,
                from_jid = Strophe.getBareJidFromJid(full_jid),
                from_nickname = (group_chat) ? group_chat.find('user nickname').text() : undefined,
                body = (group_chat) ? _.escape(group_chat.find('body').text()) : _.escape($message.children('body').text()),
                markable = $message.find('markable').length > 0,
                msgid = $message.attr('id'),
                message = msgid && this.get(msgid),
                url_media = this.parseURLFromStanza($message),
                from_avatar = (group_chat) ? group_chat.find('user metadata[xmlns="' + Strophe.NS.PUBSUB_AVATAR_METADATA + '"]') : undefined,
                role = (group_chat) ? _.escape(group_chat.find('user role').text()) : undefined,
                badge = (group_chat) ? _.escape(group_chat.find('user badge').text()) : undefined,
                from_id = (group_chat) ? group_chat.find('user').attr('id') : undefined;
            if ((message)&&(!options.context_message)&&(!options.searched_message)&&(!options.pinned_message)&&(!options.participant_message)) {
                return message;
            }
            var attrs = {
                xml: options.xml || $message[0],
                carbon_copied: options.carbon_copied && !options.is_archived,
                markable: markable,
                msgid: msgid,
                is_forwarded: options.is_forwarded,
                forwarded_message: options.forwarded_message || null,
                from_jid: from_jid,
                archive_id: options.archive_id,
                is_archived: options.is_archived
            };

            if (attrs.forwarded_message) {
                body = _.escape($message.children('comment').text());
            }

            if (!_.isUndefined(url_media)) {
                var $field_tag = $message.children('x[xmlns="' + Strophe.NS.XFORM + '"]').children('field'),
                    files = [],
                    images = [];
                $field_tag.each(function(idx, field) {
                    var $field = $(field),
                        field_type = $field.attr('type'),
                        media_tag = $field.children('media'),
                        uri_tag = media_tag.children('uri'),
                        filename = $field.attr('label'),
                        full_type = uri_tag.attr('type'),
                        filesize = uri_tag.attr('size'),
                        fileduration = uri_tag.attr('duration'),
                        type = (!_.isUndefined(full_type)) ? this.getFileType(full_type) : full_type;
                    if (!filename)
                        filename = this.getFilename(uri_tag.text());
                    if (typeof(Number(filesize)) != 'number')
                        filesize = undefined;
                    if (type == 'image') {
                        var height = media_tag.attr('height'),
                            width = media_tag.attr('width');
                        images.push({ url: url_media[idx], height: height, width: width, name: filename});
                    }
                    else {
                        if (field_type == 'voice')
                            attrs.voice_message = true;
                        else
                            attrs.voice_message = false;
                        files.push({
                            name: filename,
                            url: url_media[idx],
                            type: full_type,
                            size: (filesize) ? utils.pretty_size(filesize) : undefined,
                            duration: (fileduration) ? utils.pretty_duration(fileduration) : undefined,
                            voice: attrs.voice_message
                        });
                    }
                }.bind(this));
                if (images.length > 0)
                    attrs.images = images;
                if (files.length > 0)
                    attrs.files = files;
            }

            if (group_chat) {
                var groupchat_jid = Strophe.getBareJidFromJid($message.attr('from')),
                    groupchat_contact = this.account.contacts.mergeContact(groupchat_jid);
                if (group_chat.find('kicked').length || group_chat.find('no-permission').length || group_chat.find('join').length || group_chat.find('left').length || group_chat.find('user-updated').length || group_chat.find('create').length) {
                    attrs.type = 'system';
                    attrs.from_jid = Strophe.getBareJidFromJid($message.attr('from'));
                    if (group_chat.find('create').length)
                        attrs.system_last_message = 'Group chat was created';
                    attrs.members_actions = true;
                    body = _.escape($message.children('body').text());
                }
                let groupchat_roster_version = group_chat.attr('version');
                if (groupchat_roster_version && groupchat_contact.participants) {
                    if ((groupchat_contact.participants.version < groupchat_roster_version) && groupchat_contact.details_view.isVisible() && groupchat_contact.details_view.$('.active[data-section="participants"]').length)
                        groupchat_contact.details_view.child('participants').participantsRequest();
                }
            }

            if (from_avatar) {
                if (from_avatar.length)
                    if (from_avatar.children().length)
                        attrs.from_avatar = from_avatar.find('info').attr('id');
            }

            if (from_nickname) {
                if (from_nickname.length)
                    attrs.from_nickname = from_nickname;
            }

            if (from_id) {
                if (from_id.length)
                    attrs.from_id = from_id;
            }

            if (role) {
                if (role.length)
                    attrs.role = role[0].toUpperCase() + role.substr(1, role.length - 1);
            }

            if (badge) {
                if (badge.length)
                    attrs.badge = badge;
            }

            if (invite_group_chat.length) {
                attrs.invite = true;
                attrs.type = 'system';
            }
            $delay.length && (attrs.time = $delay.attr('stamp'));
            body && (attrs.message = body);
            attrs.carbon_copied && (attrs.state = constants.MSG_SENT);
            options.is_archived && (attrs.state = constants.MSG_ARCHIVED);
            options.echo_msg && (attrs.state = constants.MSG_DISPLAYED);
            (options.context_message || options.participant_message || options.searched_message) && (attrs.state = constants.MSG_ARCHIVED);

            if (options.pinned_message)
                return this.account.pinned_messages.create(attrs);

            if (options.participant_message)
                return this.account.participant_messages.create(attrs);

            if (options.searched_message)
                return this.account.searched_messages.create(attrs);

            if (options.context_message)
                return this.account.context_messages.create(attrs);

            if (invite_group_chat.length) {
                var contact = this.account.contacts.mergeContact(Strophe.getBareJidFromJid(from_jid));
                var chat = this.account.chats.getChat(contact);
                contact.set('group_chat', true);
                contact.set('in_roster', false);
                var invite_msg_text = Strophe.getBareJidFromJid($message.attr('from')) + ' invites you to join group chat. If you accept, ' + this.account.get('jid') + ' username shall be visible to group chat participants';
                contact.invitation.updateInviteMsg(invite_msg_text);
                chat.messages.createSystemMessage({
                    from_jid: from_jid,
                    auth_request: true,
                    invite: true,
                    is_accepted: false,
                    silent: false,
                    message: invite_msg_text
                });
                return;
            }
            else {
                message = this.create(attrs);
            }
            return message;
            },

        getFilename: function (url_media) {
            var idx = url_media.lastIndexOf("/");
            return url_media.substr(idx + 1, url_media.length - 1);
        },

        // parse src of image (XEP-0221 standard)
        parseURLFromStanza: function($message) {
            var $media = $message.find('media');
            if (($media.length)&&($media.attr('xmlns') == Strophe.NS.MEDIA)) {
                var getURL = [];
                $message.find('uri').each(function(idx, item) {
                    getURL.push($(item).text().trim());
                });
                return getURL;
            }
        },

        getFileType: function(full_type) {
            var type = full_type.slice(0, full_type.indexOf("/"));
            return type;

        },

        createSystemMessage: function (attrs) {
            return this.create(_.extend({
                type: 'system',
                silent: true,
                state: constants.MSG_DISPLAYED
            }, attrs));
        }
    });

    xabber.Chat = Backbone.Model.extend({
        defaults: {
            opened: true,
            active: false,
            display: false,
            displayed_sent: false,
            unread: 0,
            timestamp: 0
        },

        initialize: function (attrs, options) {
            this.contact = options.contact;
            this.account = this.contact.account;
            var jid = this.contact.get('jid');
            this.set({
                id: this.contact.hash_id,
                jid: jid
            });
            this.message_retraction_version = 0;
            this.contact.set('muted', _.contains(this.account.chat_settings.get('muted'), jid));
            this.contact.set('archived', _.contains(this.account.chat_settings.get('archived'), jid));
            this.messages = new xabber.Messages(null, {account: this.account});
            this.messages_unread = new xabber.Messages(null, {account: this.account});
            this.item_view = new xabber.ChatItemView({model: this});
            this.contact.on("destroy", this.destroy, this);
        },

        recountUnread: function () {
            this.set('unread', this.messages_unread.length);
            if ((this.contact.get('archived'))&&(this.contact.get('muted'))) {
            }
            else {
                xabber.toolbar_view.recountAllMessageCounter();
            }
        },

        resetUnread: function () {
            var unread = this.get('unread');
            if (unread > 0) {
                this.set('unread', 0);
                xabber.recountAllMessageCounter(unread);
                xabber.toolbar_view.recountAllMessageCounter(unread);
            }
        },

        searchMessages: function (query, callback) {
            this.contact.messages_view = new xabber.SearchedMessagesView({
                contact: this.contact,
                query_text: query,
                model: this
            });
            this.contact.messages_view.messagesRequest({}, function () {
                xabber.body.setScreen('all-chats', {
                    right: 'participant_messages',
                    contact: this.contact
                });
            }.bind(this));
        },

        receiveMessage: function ($message, options) {
            var carbon_copied = options.carbon_copied;
            // searching chat marker message
            var $marker = $message.children('[xmlns="'+Strophe.NS.CHAT_MARKERS+'"]'),
                $receipt_request = $message.children('request[xmlns="'+Strophe.NS.RECEIPTS +'"]'),
                $receipt_response = $message.children('received[xmlns="'+Strophe.NS.RECEIPTS +'"]');
            if ($marker.length) {
                var marker_tag = $marker[0].tagName.toLowerCase();
                if ((marker_tag === 'markable') && !options.is_mam && !options.is_archived && !carbon_copied)
                    this.sendMarker($message.attr('id'), 'received');
                if ((marker_tag !== 'markable') && !carbon_copied) {
                    this.receiveMarker($message, marker_tag, carbon_copied);
                    return;
                }
                if ((marker_tag === 'displayed') && carbon_copied)
                    this.receiveCarbonsMarker($marker);
            }

            if ($receipt_request.length && !options.is_mam && !options.is_archived && !carbon_copied) {
                this.sendDeliveryReceipt($message);
            }

            if ($receipt_response.length) {
                this.receiveDeliveryReceipt($message);
            }

            if (!$message.find('body').length) {
                var view = xabber.chats_view.child(this.contact.hash_id);
                if (view && view.content) {
                    view.content.receiveNoTextMessage($message, carbon_copied);
                }
                return;
            }

            if (!options.is_archived) {
                var $stanza_id = ($message.find('x[xmlns="' + Strophe.NS.GROUP_CHAT + '"]').length) ? $message.find('stanza-id[by="' + Strophe.getBareJidFromJid($message.attr('from')) + '"]') : $message.find('stanza-id'),
                    $archived = $message.find('archived');
                if ($stanza_id.length) {
                    options.archive_id = $stanza_id.attr('id');
                } else if ($archived.length) {
                    options.archive_id = $archived.attr('id');
                }
                return this.messages.createFromStanza($message, options);
            }

            if (options.is_archived) {
                if ($message.find('invite').length) {
                    var group_jid = $message.find('invite').attr('jid') || $message.find('message').attr('from'),
                        contact = this.account.contacts.get(group_jid);
                    if (contact)
                        if (contact.get('subscription') == 'both')
                            return;
                    var iq = $iq({type: 'get'}).c('blocklist', {xmlns: Strophe.NS.BLOCKING});
                    this.account.sendIQ(iq,
                        function (iq) {
                            var items = $(iq).find('item'),
                                current_timestamp = $message.find('delay').attr('stamp') || (options.delay) ? Number(moment(options.delay.attr('stamp'))) : moment.now(),
                                has_blocking = false;
                            if (items.length > 0) {
                                items.each(function (idx, item) {
                                    var $item = $(item),
                                        item_jid = $item.attr('jid'),
                                        last_blocking_timestamp;
                                    if (item_jid.indexOf(group_jid) > -1) {
                                        has_blocking = true;
                                        last_blocking_timestamp = item_jid.substr(item_jid.lastIndexOf("/") + 1, item_jid.length - group_jid.length);
                                        if (last_blocking_timestamp && (current_timestamp > last_blocking_timestamp))
                                            return this.messages.createFromStanza($message, options);
                                    }
                                    if ((idx == items.length - 1)&& !has_blocking) {
                                        return this.messages.createFromStanza($message, options);
                                    }
                                }.bind(this));
                            }
                            else
                                return this.messages.createFromStanza($message, options);
                        }.bind(this),
                        function () {
                            return this.messages.createFromStanza($message, options);
                        }.bind(this));
                }
                else {
                    return this.messages.createFromStanza($message, options);
                }
            }

        },

        getMessageContext: function (msgid) {
            let message = this.account.participant_messages.find(msg => msg.get('msgid') === msgid);
            if (message) {
                let stanza_id = message.get('archive_id');
                this.contact.messages_view = new xabber.MessageContextView({
                    contact: this.contact,
                    model: this,
                    stanza_id_context: stanza_id
                });
                this.contact.messages_view.messagesRequest({after: stanza_id}, function () {
                    xabber.body.setScreen('all-chats', {
                        right: 'participant_messages',
                        contact: this.contact
                    });
                }.bind(this));
            }
        },

        sendDeliveryReceipt: function ($message) {
            var $delivery_msg = $msg({from: this.account.get('jid'),
                to: this.contact.get('jid'),
                type: 'chat',
                id: uuid()})
                .c('received', { xmlns: Strophe.NS.RECEIPTS, id: $message.attr('id')});
            this.account.sendMsg($delivery_msg);
        },

        sendMarker: function (msgid, status) {
            status || (status = 'displayed');
            if ((status === 'displayed') && !this.contact.resources.chat_markers_support)
                return;
            var stanza = $msg({
                from: this.account.jid,
                to: this.get('jid'),
                type: 'chat',
                id: uuid()
            }).c(status).attrs({
                xmlns: Strophe.NS.CHAT_MARKERS,
                id: msgid
            }).up();
            this.account.sendMsg(stanza);
        },

        receiveMarker: function ($message, tag, carbon_copied) {
            var $displayed = $message.find('displayed'),
                $received = $message.find('received'),
                error = $message.attr('type') === 'error';
            if (error || !$displayed.length && !$received.length) {
                return;
            }
            var marked_msgid = $displayed.attr('id') || $received.attr('id'),
                msg = this.account.messages.get(marked_msgid);
            if (!msg) {
                return;
            }
            let msg_idx = this.messages.indexOf(msg);
            if (msg.isSenderMe()) {
                if ($received.length) {
                    let msg_state = msg.get('state');
                    if ((msg_state !== constants.MSG_ARCHIVED) && (msg_state !== constants.MSG_DISPLAYED))
                        msg.set('state', constants.MSG_DELIVERED);
                    return;
                }
                else
                    for (var i = msg_idx; i >= 0; i--) {
                        let message = this.messages.models[i];
                        if (message.isSenderMe()) {
                            if ((message.get('state') != constants.MSG_ARCHIVED) && (message.get('state') != constants.MSG_ERROR))
                                message.set('state', constants.MSG_DISPLAYED);
                            else
                                return;
                        }
                    }
            } else {
                msg.set('is_unread', false);
            }
        },

        receiveCarbonsMarker: function ($marker) {
            let msg_id = $marker.attr('id'),
                msg = this.messages.get(msg_id), msg_idx;
            msg && (msg_idx = this.messages.indexOf(msg));
            if (msg_idx > -1) {
                for (var i = msg_idx; i >= 0; i--) {
                    let message = this.messages.models[i];
                    if (message.get('is_unread'))
                        message.set('is_unread', false);
                    else
                        return;
                }
            }
        },

        receiveDeliveryReceipt: function ($message) {
            var $received = $message.find('received'),
                delivered_msgid = $received.attr('id'),
                msg = this.account.messages.get(delivered_msgid);
            if (!msg) {
                return;
            }
            if (msg.isSenderMe()) {
                msg.set('state', constants.MSG_DELIVERED);
            }
        },

        onPresence: function (type) {
            var jid = this.get('jid');
            if (!this.contact.get('group_chat')) {
                if (type === 'subscribe_from') {
                    this.messages.createSystemMessage({
                        from_jid: this.account.get('jid'),
                        silent: false,
                        message: 'Authorization request sent'
                    });
                } else if (type === 'subscribe') {
                    this.messages.createSystemMessage({
                        from_jid: jid,
                        auth_request: true,
                        is_accepted: false,
                        silent: false,
                        message: 'User ' + jid + ' wants to be in your contact list'
                    });
                } else if (type === 'subscribed') {
                    this.messages.createSystemMessage({
                        from_jid: jid,
                        system_last_message: 'Authorization granted',
                        message: 'User ' + jid + ' was authorized for chat',
                    });
                } else if (type === 'unsubscribed') {
                    this.messages.createSystemMessage({
                        from_jid: jid,
                        system_last_message: 'Authorization denied',
                        message: 'User ' + jid + ' was not authorized for chat'
                    });
                }
            }
        },

        retractMessages: function (msgs) {
            $(msgs).each(function (idx, item) {
                var stanza_id = item.get('archive_id');
                if (stanza_id) {
                    var iq_retraction = $iq({type: 'set', to: this.contact.get('jid')})
                        .c('retract-message', {id: stanza_id, xmlns: Strophe.NS.GROUP_CHAT + '#history'});
                    this.account.sendIQ(iq_retraction, function (success) {
                            this.item_view.content.removeMessage(item);
                        }.bind(this),
                        function (error) {
                            if ($(error).find('not-allowed').length)
                                utils.dialogs.error("You have no permission to delete message");
                        }.bind(this));
                }
            }.bind(this));
        },

        retractMessagesByUser: function (user_id) {
            var iq_retraction = $iq({type: 'set', to: this.contact.get('jid')})
                .c('retract-user', {id: user_id, xmlns: Strophe.NS.GROUP_CHAT + '#history'});
            this.account.sendIQ(iq_retraction, function (success) {
                    var user_msgs = this.messages.filter(msg => msg.get('from_id') == user_id);
                    $(user_msgs).each(function (idx, msg) {
                        this.item_view.content.removeMessage(msg);
                    }.bind(this));
                }.bind(this),
                function (error) {
                    if ($(error).find('not-allowed').length)
                        utils.dialogs.error("You have no permission to delete user messages");
                }.bind(this));
        },

        retractAllMessages: function () {
            var iq_retraction = $iq({type: 'set', to: this.contact.get('jid')})
                .c('retract-all', {xmlns: Strophe.NS.GROUP_CHAT + '#history'});
            this.account.sendIQ(iq_retraction, function (iq_response) {
                var all_messages = this.messages.models;
                $(all_messages).each(function (idx, msg) {
                    this.item_view.content.removeMessage(msg);
                }.bind(this));
            }.bind(this),
                function (error) {
                    if ($(error).find('not-allowed').length)
                        utils.dialogs.error("You have no permission to clear message archive");
                }.bind(this));
        },

        getAllMessageRetractions: function () {
            var retractions_query = $iq({from: this.account.get('jid'), type: 'set', to: this.contact.get('jid')})
                .c('query', { xmlns: Strophe.NS.RETRACTIONS, version: this.message_retraction_version, less_than: 20});
            this.account.sendIQ(retractions_query);
        },

        showAcceptedRequestMessage: function () {
            this.messages.createSystemMessage({
                from_jid: this.account.get('jid'),
                message: 'Authorization accepted'
            });
        },

        showDeclinedRequestMessage: function () {
            this.messages.createSystemMessage({
                from_jid: this.account.get('jid'),
                message: 'Authorization denied'
            });
        },

        showBlockedRequestMessage: function () {
            this.messages.createSystemMessage({
                from_jid: this.account.get('jid'),
                system_last_message: 'Authorization denied',
                message: this.get('jid') + ' was blocked'
            });
        }
    });

    xabber.ChatItemView = xabber.BasicView.extend({
        className: 'chat-item list-item',
        template: templates.chat_item,
        avatar_size: constants.AVATAR_SIZES.CHAT_ITEM,

        events: {
            'click': 'openByClick'
        },

        _initialize: function () {
            this.account = this.model.account;
            this.contact = this.model.contact;
            this.$el.attr('data-id', this.model.id);
            this.content = new xabber.ChatContentView({chat_item: this});
            this.updateName();
            this.updateStatus();
            this.updateCounter();
            this.updateAvatar();
            this.updateBlockedState();
            this.updateMutedState();
            this.updateArchivedState();
            this.updateColorScheme();
            this.updateGroupChats();
            this.model.on("change:active", this.updateActiveStatus, this);
            this.model.on("change:unread", this.updateCounter, this);
            this.model.on("open", this.open, this);
            this.model.on("remove_opened_chat", this.onClosed, this);
            this.model.messages.on("destroy", this.onMessageRemoved, this);
            this.contact.on("remove_invite", this.removeInvite, this);
            this.contact.on("change:name", this.updateName, this);
            this.contact.on("change:status", this.updateStatus, this);
            this.contact.on("change:image", this.updateAvatar, this);
            this.contact.on("change:blocked", this.updateBlockedState, this);
            this.contact.on("change:muted", this.updateMutedState, this);
            this.contact.on("change:archived", this.updateArchivedState, this);
            this.contact.on("change:group_chat", this.updateGroupChats, this);
            this.contact.on("change:in_roster", this.updateAcceptedStatus, this);
            this.account.settings.on("change:color", this.updateColorScheme, this);
        },

        updateName: function () {
            this.$('.chat-title').text(this.contact.get('name'));
        },

        updateStatus: function () {
            var status = this.contact.get('status');
            this.$('.status').attr('data-status', status);
        },

        updateActiveStatus: function () {
            this.$el.switchClass('active', this.model.get('active'));
        },

        updateAcceptedStatus: function () {
            if (this.contact.get('in_roster')) {
                this.model.set('is_accepted', true);
            }
        },

        updateCounter: function () {
            var unread = this.model.get('unread');
            this.$('.msg-counter').showIf(unread).text(unread || '');
        },

        updateAvatar: function () {
            var image = this.contact.cached_image;
            this.$('.circle-avatar').setAvatar(image, this.avatar_size);
        },

        updateBlockedState: function () {
            this.$el.switchClass('blocked', this.contact.get('blocked'));
        },

        updateMutedState: function () {
            let is_muted = this.contact.get('muted');
            this.$('.msg-counter').switchClass('muted-chat-counter', is_muted);
            this.$('.muted-icon').showIf(is_muted);
            this.updateCSS();
        },

        updateArchivedState: function () {
            let archived = this.contact.get('archived');
            if (archived || (!archived && xabber.toolbar_view.$('.active').hasClass('archive-chats')))
                this.$el.detach();
            if ((archived && xabber.toolbar_view.$('.active').hasClass('archive-chats')) || (!archived && !xabber.toolbar_view.$('.active').hasClass('archive-chats')))
                xabber.chats_view.updateChatPosition(this.model);
        },

        updateGroupChats: function () {
            var is_group_chat = this.contact.get('group_chat');
            this.$('.status').hideIf(is_group_chat);
            this.$('.group-chat-icon').showIf(is_group_chat);
            if (is_group_chat) {
                this.$el.addClass('group-chat');
                this.$('.chat-title').css('color', '#424242');
                this.model.set('group_chat', true);
            }
        },

        updateColorScheme: function () {
            var color = this.account.settings.get('color');
            this.$el.attr('data-color', color);
            this.content.$el.attr('data-color', color);
            this.content.head.$el.attr('data-color', color);
            this.content.bottom.$el.attr('data-color', color);
            this.$('#last-msg-file-color').css('color', color);

        },

        onMessageRemoved: function (msg) {
            if (this.model.last_message === msg) {
                var last_message;
                for (var idx = this.model.messages.length-1; idx >= 0; idx--) {
                    last_message = this.model.messages.at(idx);
                    if (!last_message.get('silent')) {
                        break;
                    }
                }
                this.model.last_message = last_message;
                this.updateLastMessage();
            }
        },

        updateLastMessage: function (msg) {
            msg || (msg = this.model.last_message);
            if (!msg) {
                return;
            }
            var msg_time = msg.get('time'),
                timestamp = msg.get('timestamp'),
                forwarded_message = msg.get('forwarded_message'),
                msg_files = msg.get('files'),
                msg_images = msg.get('images'),
                msg_text = (forwarded_message) ? (msg.get('message') || ((forwarded_message.length > 1) ? (forwarded_message.length + ' forwarded messages') : 'Forwarded message').italics()) : msg.getText(),
                color = this.account.settings.get('color');
            this.model.set({timestamp: timestamp});
            if ((msg_files) || (msg_images)) {
                var filetype;
                if ((msg_files) && (msg_images)) {
                    msg_files = (msg_files.length > 0) ? msg_files : undefined;
                    msg_images = (msg_images.length > 0) ? msg_images : undefined;
                }
                if ((msg_files) && (msg_images)) {
                    msg_text = (msg_files.length + msg_images.length + " files").fontcolor(color);
                }
                else {
                    if (msg_files) {
                        if (msg_files.length > 1) {
                            msg_text = $('<span class=text-color-500>' + msg_files.length + ' files</span>');
                        }
                        if (msg_files.length == 1) {
                            filetype = $('<span class=text-color-500>' + ((msg_files[0].type) ? msg_files[0].type[0].toUpperCase() + msg_files[0].type.substr(1, this.model.messages.getFileType(msg_files[0].type).length - 1) + ": " : "File: ") + '</span>');
                            msg_text = msg_files[0].name;
                        }
                    }
                    if (msg_images) {
                        if (msg_images.length > 1) {
                            msg_text = $('<span class=text-color-500>' + msg_images.length + ' images</span>');
                        }
                        if (msg_images.length == 1) {
                            filetype = $('<span class=text-color-500>Image: </span>');
                            msg_text = msg_images[0].name;
                        }
                    }
                }
                if (this.contact.get('group_chat')) {
                    var msg_from = msg.get('from_nickname') || (msg.isSenderMe() ? this.account.get('name') : msg.get('from_jid'));
                    this.$('.last-msg').text("").append($('<span class=text-color-700>' + msg_from + ': ' + '</span>')).append(filetype).append(msg_text);
                }
                else
                    this.$('.last-msg').text("").append(filetype).append(msg_text);
            }
            else {
                var msg_from = "";
                if (msg.get('type') == 'system') {
                    if (msg.get('auth_request')) {
                        if (msg.get('invite'))
                            msg_text = 'Invitation to group chat';
                        else
                            msg_text = 'Authorization request';
                    }
                    else {
                        if (msg.get('system_last_message'))
                            msg_text = msg.get('system_last_message');
                    }
                    if (msg.get('members_actions'))
                        msg_text = msg_text.italics();
                    else
                        msg_text = $('<span class=text-color-700>' + msg_text + '</span>');
                }
                else {
                    if (this.contact.get('group_chat')) {
                        msg_from = (msg.isSenderMe()) ? this.account.get('name') : msg.get('from_nickname') || msg.get('from_jid');
                    }
                }
                this.$('.last-msg').text("").append(msg_text);
                if (msg_from)
                    this.$('.last-msg').prepend($('<span class=text-color-700>' + msg_from + ': ' + '</span>'));
            }
            this.$el.emojify('.last-msg', {emoji_size: 14});
            this.$('.last-msg-date').text(utils.pretty_short_datetime(msg_time))
                .attr('title', utils.pretty_datetime(msg_time));
            this.$('.msg-delivering-state').showIf(msg.isSenderMe()&&(msg.get('state') !== constants.MSG_ARCHIVED))
                .attr('data-state', msg.getState());
            this.updateCSS();
        },

        updateCSS: function () {
            var date_width = this.$('.last-msg-date').width();
            this.$('.chat-title-wrap').css('padding-right', date_width + 5);
            var title_width = this.$('.chat-title-wrap').width();
            this.contact.get('muted') && (title_width -= 24);
            this.$('.chat-title').css('max-width', title_width);
        },

        openByClick: function () {
            this.open();
        },

        open: function (options) {
            options || (options = {clear_search: true});
            if ((!this.model.get('history_loaded'))&&(this.model.messages.length < 20))
                this.content.loadPreviousHistory();
            xabber.chats_view.openChat(this, options);
        },

        removeInvite: function (options) {
            options || (options = {});
            xabber.chats_view.removeInvite(this, options);
        },

        onClosed: function () {
            this.parent.onChatRemoved(this.model, {soft: true});
        }
    });

      xabber.MessagesView = xabber.BasicView.extend({
          template: templates.chat_content,
          ps_selector: '.chat-content',
          ps_settings: {
              wheelPropagation: true
          },
          avatar_size: constants.AVATAR_SIZES.CHAT_MESSAGE,

          _initialize: function (options) {
              this.model = options.model;
              this.contact = options.contact;
              this.account = this.contact.account;
              let color = this.account.settings.get('color');
              this.$el.attr('data-color', color);
              this.loading_history = false;
              this.history_loaded = false;
              this.last_msg_id = 0;
              this._scrolltop = this.getScrollTop();
              this.ps_container.on("ps-scroll-up ps-scroll-down", this.onScroll.bind(this));
              this.chat_content = options.chat_content || this.account.chats.get(this.contact.hash_id).item_view.content;
              let wheel_ev = this.defineMouseWheelEvent();
              this.$el.on(wheel_ev, this.onMouseWheel.bind(this));
              this.$('.back-to-bottom').click(this.backToBottom.bind(this));
          },

          defineMouseWheelEvent: function () {
              if (!_.isUndefined(window.onwheel)) {
                  return "wheel";
              } else if (!_.isUndefined(window.onmousewheel)) {
                  return "mousewheel";
              } else {
                  return "MozMousePixelScroll";
              }
          },

          onMouseWheel: function (ev) {
              this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
          },

          onClickMessage:function (ev) {
              this.chat_content.onClickMessage(ev);
          },

          onClickLink:function (ev) {
              this.chat_content.onClickLink(ev);
          },

          onScroll: function () {
              this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
              this._prev_scrolltop = this._scrolltop || 0;
              this._scrolltop = this.getScrollTop();
              if (!this.history_loaded && !this.loading_history && (this._scrolltop < this._prev_scrolltop) && (this._scrolltop < 100 || this.getPercentScrolled() < 0.1)) {
                  this.loading_history = true;
                  this.messagesRequest({before: this.last_msg_id}, function () {
                      this.loading_history = false;
                  }.bind(this));
              }
          },

          backToBottom: function () {
              this.scrollToBottom();
              this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
          },

          messagesRequest: function () {},

          emptyChat: function () {
              this.$('.chat-content').html($('<span class="error"/>').text('No messages'));
          },

          openChat: function () {
              this.contact.trigger("open_chat", this.contact);
          },

          addMessageHTML: function ($message, index) {
              if (index === 0) {
                  $message.prependTo(this.$('.chat-content'));
              } else {
                  $message.insertAfter(this.$('.chat-message').eq(index - 1));
              }
              let $next_message = $message.nextAll('.chat-message').first();
              this.chat_content.updateMessageInChat($message[0]);
              if ($next_message.length) {
                  this.chat_content.updateMessageInChat($next_message[0]);
              }
              this.chat_content.initPopup($message);
              return $message;
          }

      });

      xabber.MessageContextView = xabber.MessagesView.extend({
          className: 'chat-content-wrap messagex-context-wrap',

          events: {
              'click .chat-message': 'onClickMessage',
              'click .mdi-link-variant': 'onClickLink',
              "keyup .messages-search-form": "keyupSearch"
          },

          __initialize: function (options) {
              this.stanza_id = options.stanza_id_context;
              this.account.context_messages = new xabber.Messages(null, {account: this.account});
              this.account.context_messages.on("add", this.addMessage, this);
          },

          render: function () {
              // this.scrollToBottom();
          },

          messagesRequest: function (query, callback) {
              let messages = [],
                  options = query || {},
                  queryid = uuid();
              !options.max && (options.max = xabber.settings.mam_messages_limit);
              !options.after && !options.before && (options.before = '');
              let handler = this.account.connection.addHandler(function (message) {
                  let $msg = $(message);
                  if ($msg.find('result').attr('queryid') === queryid) {
                      messages.push(message);
                  }
                  return true;
              }.bind(this), Strophe.NS.MAM);
              this.chat_content.MAMRequest(options,
                  function (success, messages, rsm) {
                      this.account.connection.deleteHandler(handler);
                      rsm && (this.last_msg_id = rsm.first);
                      if (!messages.length && !this.account.context_messages) {
                          this.emptyChat();
                      }
                      if (messages.length < options.max)
                          this.history_loaded = true;
                      $(messages).each(function (idx, message) {
                          let $message = $(message);
                          this.account.chats.receiveChatMessage($message, {context_message: true});
                      }.bind(this));
                      callback && callback();
                  }.bind(this),
                  function () {
                      this.account.connection.deleteHandler(handler);
                  }.bind(this)
              );
          },

          addMessage: function (message) {
              if (message.get('auth_request')) {
                  return;
              }
              let $message = this.chat_content.buildMessageHtml(message),
                  index = this.account.context_messages.indexOf(message);
              this.addMessageHTML($message, index);
          }
      });

      xabber.SearchedMessagesView = xabber.MessagesView.extend({
          className: 'chat-content-wrap searched-messages-wrap',

          events: {
              'click .chat-message': 'onClickMessage',
              'click .mdi-link-variant': 'onClickLink',
              "click .btn-cancel-searching": "openChat",
              "keyup .messages-search-form": "keyupSearch"
          },

          __initialize: function (options) {
              this.query_text = options.query_text;
              this.account.searched_messages = new xabber.Messages(null, {account: this.account});
              this.account.searched_messages.on("add", this.addMessage, this);
              this.$search_form = this.$('.search-form-header');
              return this;
          },

          render: function () {
              this.$search_form.find('input').val(this.query_text);
              this.$search_form.slideToggle(10, function () {
                  if (this.$search_form.css('display') === 'none')
                      this.$el.css('padding-top', '0');
                  else {
                      this.$el.css('padding-top', '36px');
                      this.$search_form.find('input').focus();
                  }
                  this.scrollToBottom();
              }.bind(this));
              this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
          },

          messagesRequest: function (query, callback) {
              let messages = [],
                  options = query || {},
                  queryid = uuid();
              _.extend(options, {
                  max: xabber.settings.mam_messages_limit,
                  before: query.before || '',
                  var: [{var: 'withtext', value: this.query_text}]
              });
              let handler = this.account.connection.addHandler(function (message) {
                  let $msg = $(message);
                  if ($msg.find('result').attr('queryid') === queryid) {
                      messages.push(message);
                  }
                  return true;
              }.bind(this), Strophe.NS.MAM);
              this.chat_content.MAMRequest(options,
                  function (success, messages, rsm) {
                      this.account.connection.deleteHandler(handler);
                      rsm && (this.last_msg_id = rsm.first);
                      if (!messages.length && !this.account.searched_messages) {
                          this.emptyChat();
                      }
                      if (messages.length < options.max)
                          this.history_loaded = true;
                      $(messages).each(function (idx, message) {
                          let $message = $(message);
                          this.account.chats.receiveChatMessage($message, {searched_message: true});
                      }.bind(this));
                      callback && callback();
                  }.bind(this),
                  function () {
                      this.account.connection.deleteHandler(handler);
                  }.bind(this)
              );
          },

          keyupSearch: function (ev) {
              if (ev.keyCode === constants.KEY_ENTER) {
                  let query = this.$search_form.find('input').val();
                  this.model.searchMessages(query, function (messages) {
                  }.bind(this));
              }
              if (ev.keyCode === constants.KEY_ESCAPE) {
                  this.chat_contentF.head.renderSearchPanel();
              }
          },

          addMessage: function (message) {
              if (message.get('auth_request')) {
                  return;
              }
              let $message = this.chat_content.buildMessageHtml(message).addClass('participant-message'),
                  index = this.account.searched_messages.indexOf(message);
              this.addMessageHTML($message, index);
          }
      });

      xabber.ParticipantMessagesView = xabber.MessagesView.extend({
          className: 'chat-content-wrap participant-messages-wrap',

          events: {
              'click .chat-message': 'onClickMessage',
              'click .mdi-link-variant': 'onClickLink',
              'click .btn-cancel-selection' : 'openChat',
              'click .btn-retract-messages' : 'retractMessages'
          },

          __initialize: function (options) {
              this.participant = options.model;
              this.member_jid = _.unescape(this.participant.jid);
              this.member_id = this.participant.id;
              this.member_nickname = _.unescape(this.participant.nickname);
              this.account.participant_messages = new xabber.Messages(null, {account: this.account});
              this.account.participant_messages.on("add", this.addMessage, this);
              this.account.participant_messages.on("change:last_replace_time", this.chat_content.updateMessage, this);
              this.ps_container.on("ps-scroll-y", this.onScrollY.bind(this));
              return this;
          },

          render: function () {
              this.$('.chat-content').css('height', 'calc(100% - 32px)');
              this.$('.participant-messages-header .messages-by-header .participant-nickname').text(this.member_nickname);
              this.$('.participant-messages-header').removeClass('hidden');
              this.scrollToBottom();
              this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
          },

          onScrollY: function () {

          },

          retractMessages: function () {
              utils.dialogs.ask("Delete user messages",
                  "Delete all " + ('<span class="' + this.account.settings.get('color') + '-text">' + (this.member_nickname || this.member_jid || this.member_id) + '</span>') + " messages in this group chat?",
                  null, { ok_button_text: 'delete'}).done(function (result) {
                  if (result) {
                      if (this.member_id) {
                          this.chat_content.model.retractMessagesByUser(this.member_id, function () {
                              this.emptyChat();
                          }.bind(this));
                      }
                  }
              }.bind(this));
          },

          messagesRequest: function (query, callback) {
              let messages = [],
                  options = query || {},
                  member_id = this.member_id,
                  queryid = uuid();
              _.extend(options, {
                  max: xabber.settings.mam_messages_limit,
                  before: query.before || '',
                  var: [{var: 'with', value: member_id}]
              });
              let handler = this.account.connection.addHandler(function (message) {
                  let $msg = $(message);
                  if ($msg.find('result').attr('queryid') === queryid) {
                      messages.push(message);
                  }
                  return true;
              }.bind(this), Strophe.NS.MAM);
              this.chat_content.MAMRequest(options,
                  function (success, messages, rsm) {
                      this.account.connection.deleteHandler(handler);
                      rsm && (this.last_msg_id = rsm.first);
                      if (!messages.length && !this.account.participant_messages.length) {
                          this.emptyChat();
                      }
                      if (messages.length < options.max)
                          this.history_loaded = true;
                      $(messages).each(function (idx, message) {
                          let $message = $(message);
                          this.account.chats.receiveChatMessage($message, {participant_message: true});
                      }.bind(this));
                      callback && callback();
                  }.bind(this),
                  function () {
                      this.account.connection.deleteHandler(handler);
                  }.bind(this)
              );
          },

          addMessage: function (message) {
              if (message.get('auth_request')) {
                  return;
              }
              let $message = this.chat_content.buildMessageHtml(message).addClass('participant-message'),
                  index = this.account.participant_messages.indexOf(message);
              this.addMessageHTML($message, index);
          }
      });

    xabber.ChatContentView = xabber.BasicView.extend({
        className: 'chat-content-wrap',
        template: templates.chat_content,
        ps_selector: '.chat-content',
        ps_settings: {
            wheelPropagation: true
        },
        avatar_size: constants.AVATAR_SIZES.CHAT_MESSAGE,

        events: {
            'mousedown .chat-message': 'onTouchMessage',
            'click .chat-message': 'onClickMessage',
            'click .mdi-link-variant' : 'onClickLink',
            'click .pinned-message' : 'showPinnedMessage',
            "keyup .messages-search-form": "keyupSearch",
            "click .btn-cancel-searching": "cancelSearch",
            "click .back-to-bottom": "backToBottom"
        },

        _initialize: function (options) {
            this.chat_item = options.chat_item;
            this.current_day_indicator = null;
            this.prev_audio_message;
            this.account = this.chat_item.account;
            this.model = this.chat_item.model;
            this.contact = this.model.contact;
            this.head = new xabber.ChatHeadView({content: this});
            this.bottom = new xabber.ChatBottomView({content: this});
            this.$history_feedback = this.$('.load-history-feedback');
            this.$pinned_message = this.$('.pinned-message');
            this.$search_form = this.$('.search-form-header');
            this.$el.attr('data-id', this.model.id);
            this._scrolltop = this.getScrollTop();
            let wheel_ev = this.defineMouseWheelEvent();
            this.$el.on(wheel_ev, this.onMouseWheel.bind(this));
            this.ps_container.on("ps-scroll-up ps-scroll-down", this.onScroll.bind(this));
            this.ps_container.on("ps-scroll-y", this.onScrollY.bind(this));
            this.model.on("change:active", this.onChangedActiveStatus, this);
            this.model.on("load_last_history", this.loadLastHistory, this);
            this.model.messages.on("add", this.onMessage, this);
            this.model.messages.on("change:state", this.onChangedMessageState, this);
            this.model.messages.on("change:is_unread", this.onChangedReadState, this);
            this.model.messages.on("change:last_replace_time", this.updateMessage, this);
            this.contact.on("change:blocked", this.updateBlockedState, this);
            this.contact.on("change:group_chat", this.updateGroupChat, this);
            this.contact.on("remove_from_blocklist", this.loadLastHistory, this);
            this.account.contacts.on("change:name", this.updateName, this);
            this.account.contacts.on("change:image", this.updateAvatar, this);
            this.account.on("change", this.updateMyInfo, this);
            this.account.dfd_presence.done(function () {
                this.loadLastHistory();
            }.bind(this));
            this.account.on("get_missed_history", this.requestMissedMessages, this);
            return this;
        },

        defineMouseWheelEvent: function () {
            if (!_.isUndefined(window.onwheel)) {
                return "wheel";
            } else if (!_.isUndefined(window.onmousewheel)) {
                return "mousewheel";
            } else {
                return "MozMousePixelScroll";
            }
        },

        updateMyInfo: function () {
            let changed = this.account.changed;
            if (_.has(changed, 'name')) this.updateMyName();
            if (_.has(changed, 'status')) this.updateMyStatus();
            if (_.has(changed, 'image')) this.updateMyAvatar();
        },

        updateGroupChat: function () {
            this._loading_history = false;
            this.model.set('history_loaded', false);
            // this.loadLastHistory();
        },

        render: function () {
            this.cancelSearch();
            this.scrollToBottom();
            this.onScroll();
            this.updateContactStatus();
            this.updatePinnedMessage();
        },

        cancelSearch: function () {
            this.$search_form.hide().find('input').val("");
            this.$el.css('padding-top', '0');
        },

        updateContactStatus: function () {
            if ((this.head.$('.contact-status').attr('data-status') == 'offline')&&(this.contact.get('last_seen'))) {
                var seconds = (moment.now() - this.contact.get('last_seen'))/1000,
                    new_status = this.contact.lastSeenNewFormat(seconds, this.contact.get('last_seen'));
                this.contact.set({status_message: new_status });
            }
        },

        updatePinnedMessage: function () {
            let $pinned_message = this.contact.get('pinned_message');
            this.contact.renderPinnedMessage($pinned_message, this.$pinned_message);
        },

        onChangedVisibility: function () {
            if (this.isVisible()) {
                this.model.set({display: true, active: true});
                this.readMessages();
            } else {
                this.model.set({display: false});
            }
        },

        onChangedActiveStatus: function () {
            this.sendChatState(this.model.get('active') ? 'active' : 'inactive');
            if (this.contact.get('group_chat')) {
                if (this.model.get('active'))
                    this.contact.subGroupPres();
                else
                    this.contact.unsubGroupPres();
            }
        },

        updateName: function (contact) {
            var name = contact.get('name'),
                jid = contact.get('jid');
            if (contact === this.contact) {
                this.$('.chat-message.with-author[data-from="'+jid+'"]').each(function () {
                    $(this).find('.chat-msg-author').text(name);
                });
            } else {
                this.$('.fwd-message.with-author[data-from="'+jid+'"]').each(function () {
                    $(this).find('.fwd-msg-author').text(name);
                });
            }
        },

        updateAvatar: function (contact) {
            var image = contact.cached_image,
                jid = contact.get('jid');
            if (contact === this.contact) {
                this.$('.chat-message.with-author[data-from="'+jid+'"]').each(function () {
                    $(this).find('.left-side .circle-avatar').setAvatar(
                            image, this.avatar_size);
                });
            } else {
                this.$('.fwd-message.with-author[data-from="'+jid+'"]').each(function () {
                    $(this).find('.fwd-left-side .circle-avatar').setAvatar(
                            image, this.avatar_size);
                });
            }
        },

        updateMyStatus: function () {
            let text;
            if (!this.account.isOnline()) {
                text = 'You are offline';
            }
            this.bottom.showChatNotification(text || '', true);
        },

        updateMyName: function () {
            var name = this.account.get('name'),
                jid = this.account.get('jid');
            this.$('.chat-message.with-author[data-from="'+jid+'"]').each(function () {
                $(this).find('.chat-msg-author').text(name);
            });
            this.$('.fwd-message.with-author[data-from="'+jid+'"]').each(function () {
                $(this).find('.fwd-msg-author').text(name);
            });
        },

        updateMyAvatar: function () {
            var image = this.account.cached_image,
                jid = this.account.get('jid');
            this.$('.chat-message.with-author[data-from="'+jid+'"]').each(function () {
                $(this).find('.left-side .circle-avatar').setAvatar(
                        image, this.avatar_size);
            });
            this.$('.fwd-message.with-author[data-from="'+jid+'"]').each(function () {
                $(this).find('.fwd-left-side .circle-avatar').setAvatar(
                        image, this.avatar_size);
            });
        },

        updateBlockedState: function () {
            if (this.contact.get('blocked')) {
                this.model.showBlockedRequestMessage();
            }
        },

        readMessages: function (timestamp) {
            var unread_messages = _.clone(this.model.messages_unread.models);
            if (unread_messages.length)
                this.model.sendMarker(unread_messages[unread_messages.length - 1].get('msgid'), 'displayed');
            _.each(unread_messages, function (msg) {
                if (!timestamp || msg.get('timestamp') <= timestamp) {
                    if (this.model.get('is_accepted') != false)
                        msg.set('is_unread', false);
                }
            }.bind(this));
        },

        onMouseWheel: function (ev) {
            if (ev.originalEvent.deltaY < 0) {
                this.loadPreviousHistory();
            }
            this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
        },

        keyupSearch: function (ev) {
            if (ev.keyCode === constants.KEY_ENTER) {
                let query = this.$search_form.find('input').val();
                this.model.searchMessages(query, function (messages) {}.bind(this));
            }
            if (ev.keyCode === constants.KEY_ESCAPE) {
                this.head.renderSearchPanel();
            }
        },

        onScrollY: function () {
            if (this._scrolltop === 0) {
                this.$('.fixed-day-indicator-wrap').css('opacity', 1);
                this.current_day_indicator = utils.pretty_date(parseInt(this.$('.chat-content').children().first().data('time')));
                this.showDayIndicator(this.current_day_indicator);
            }
            this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
        },

        onScroll: function () {
            this.$('.back-to-bottom').hideIf(this.isScrolledToBottom());
            let $chatday_indicator = this.$('.chat-day-indicator'),
                $messages = this.$('.chat-message'),
                indicator_idx = undefined,
                opacity_value;
            this._prev_scrolltop = this._scrolltop || 0;
            this._scrolltop = this.getScrollTop();
            $chatday_indicator.each(function (idx, indicator) {
                if (this._scrolltop < this._prev_scrolltop) {
                    if ((indicator.offsetTop <= this._scrolltop) && (indicator.offsetTop >= this._scrolltop - 30)) {
                        indicator_idx = idx;
                        opacity_value = 0;
                        return false;
                    }
                    if ((indicator.offsetTop >= this._scrolltop) && (indicator.offsetTop <= this._scrolltop - 30)) {
                        indicator_idx = idx && (idx - 1);
                        opacity_value = 1;
                        return false;
                    }
                }
                else {
                    if ((indicator.offsetTop <= this._scrolltop + 30) && (indicator.offsetTop >= this._scrolltop)) {
                        indicator_idx = idx && (idx - 1);
                        opacity_value = 0;
                        return false;
                    }
                    if ((indicator.offsetTop >= this._scrolltop - 30) && (indicator.offsetTop <= this._scrolltop)) {
                        indicator_idx = idx;
                        opacity_value = 1;
                        return false;
                    }
                }
            }.bind(this));
            if (indicator_idx) {
                this.$('.fixed-day-indicator-wrap').css('opacity', opacity_value);
                this.current_day_indicator = utils.pretty_date(parseInt($($chatday_indicator[indicator_idx]).attr('data-time')));
            }
            else {
                $messages.each(function (idx, msg) {
                    if ((msg.offsetTop + $(msg).height() > this._scrolltop) && (msg.offsetTop < this._scrolltop)) {
                        indicator_idx = idx;
                        opacity_value = 1;
                        return false;
                    }
                }.bind(this));
                if (indicator_idx) {
                    this.$('.fixed-day-indicator-wrap').css('opacity', opacity_value);
                    this.current_day_indicator = utils.pretty_date(parseInt($($messages[indicator_idx]).attr('data-time')));
                }
            }
            if (this.current_day_indicator !== null) {
                this.showDayIndicator(this.current_day_indicator);
            }
            if (this._scrolltop < this._prev_scrolltop &&
                (this._scrolltop < 100 || this.getPercentScrolled() < 0.1)) {
                this.loadPreviousHistory();
            }
        },

        backToBottom: function () {
            this.scrollToBottom();
        },

        MAMRequest: function (options, callback, errback) {
            var account = this.account,
                contact = this.contact,
                messages = [], queryid = uuid(),
                is_groupchat = contact.get('group_chat'), success = true, iq;
            if (is_groupchat)
                iq = $iq({type: 'set', to: contact.get('jid')});
            else
                iq = $iq({type: 'set'});
            iq.c('query', {xmlns: Strophe.NS.MAM, queryid: queryid})
                    .c('x', {xmlns: Strophe.NS.XFORM, type: 'submit'})
                    .c('field', {'var': 'FORM_TYPE', type: 'hidden'})
                    .c('value').t(Strophe.NS.MAM).up().up();
            if (!is_groupchat)
                iq.c('field', {'var': 'with'})
                    .c('value').t(this.model.get('jid')).up().up();
            else if (options.var) {
                options.var.forEach(function (opt_var) {
                    iq.c('field', {'var': opt_var.var})
                        .c('value').t(opt_var.value).up().up();
                }.bind(this));
            }
            iq.up().cnode(new Strophe.RSM(options).toXML());
            var deferred = new $.Deferred();
            account.chats.onStartedMAMRequest(deferred);
            deferred.done(function () {
                var handler = account.connection.addHandler(function (message) {
                    if (is_groupchat == contact.get('group_chat')) {
                        var $msg = $(message);
                        if ($msg.find('result').attr('queryid') === queryid) {
                            messages.push(message);
                        }
                    }
                    else {
                        messages = [];
                        success = false;
                    }
                    return true;
                }, Strophe.NS.MAM);
                account.sendIQ(iq,
                    function (res) {
                        account.connection.deleteHandler(handler);
                        account.chats.onCompletedMAMRequest(deferred);
                        var $fin = $(res).find('fin[xmlns="'+Strophe.NS.MAM+'"]');
                        if ($fin.length && $fin.attr('queryid') === queryid) {
                            var rsm = new Strophe.RSM({xml: $fin.find('set')[0]});
                            callback && callback(success, messages, rsm);
                        }
                    },
                    function (err) {
                        account.connection.deleteHandler(handler);
                        xabber.error("MAM error");
                        xabber.error(err);
                        account.chats.onCompletedMAMRequest(deferred);
                        errback && errback(err);
                    }
                );
            });
        },

        getMessageArchive: function (query, options) {
            if (options.previous_history) {
                if (this._loading_history || this.model.get('history_loaded')) {
                    return;
                }
                this._loading_history = true;
                this.showHistoryFeedback();
            }
            var account = this.model.account, counter = 0;
                this.MAMRequest(query,
                    function (success, messages, rsm) {
                        this._loading_history = false;
                        this.hideHistoryFeedback();
                        if (this.contact.get('group_chat')) {
                            options.last_history && this.model.getAllMessageRetractions();
                            if (!this.contact.my_info)
                                this.contact.getMyInfo();
                        }
                        else {
                            if (!this.contact.get('last_seen') && !this.contact.get('is_server'))
                                this.contact.getLastSeen();
                        }
                        if ((messages.length < query.max) && success) {
                            this.model.set('history_loaded', true);
                        }
                        if (options.previous_history || !this.model.get('first_archive_id')) {
                            rsm.first && this.model.set('first_archive_id', rsm.first);
                        }
                        if (options.last_history || !this.model.get('last_archive_id')) {
                            rsm.last && this.model.set('last_archive_id', rsm.last);
                        }
                        _.each(messages, function (message) {
                            var loaded_message = account.chats.receiveChatMessage(message,
                                _.extend({is_archived: true}, options)
                            );
                            if (loaded_message) counter++;
                        });
                        if ((counter === 0) && options.last_history && !this.model.get('history_loaded')) {
                            this.getMessageArchive(_.extend(query, {
                                max: xabber.settings.mam_messages_limit,
                                before: this.model.get('first_archive_id') || ''
                            }), {previous_history: true});
                        }
                    }.bind(this),
                    function (err) {
                        if (options.previous_history) {
                            this._loading_history = false;
                            this.showHistoryFeedback(true);
                        }
                    }.bind(this)
                );
        },

        requestMissedMessages: function () {
            let query = {},
                start_timestamp = moment(this.account.disconnected_timestamp).format();
                //end_timestamp = moment(moment.now()).format();
            query.var = [{var: 'start', value: start_timestamp}];
            this.getMessageArchive(query, {missed_history: true});
        },

        loadLastHistory: function () {
            if (!xabber.settings.load_history) {
                return;
            }
            var last_archive_id = this.model.get('last_archive_id'),
                query = {};
            if (last_archive_id) {
                query.after = last_archive_id;
            } else {
                query.before = '';
                query.max = xabber.settings.mam_messages_limit_start;
            }
            this.getMessageArchive(query, {last_history: true});
        },

        loadPreviousHistory: function () {
            if (!xabber.settings.load_history) {
                return;
            }
            this.getMessageArchive({
                max: xabber.settings.mam_messages_limit,
                before: this.model.get('first_archive_id') || '' },
                {previous_history: true
                });
        },

        showHistoryFeedback: function (is_error) {
            if (this._load_history_feedback_timeout) {
                clearTimeout(this._load_history_feedback_timeout);
                this._load_history_feedback_timeout = null;
            }
            var text = is_error ? 'Error while loading archived messages' : 'Loading messages...';
            this.$history_feedback.text(text).removeClass('hidden');
            if (is_error) {
                this._load_history_feedback_timeout = setTimeout(
                    this.hideHistoryFeedback.bind(this), 5000);
            }
        },

        showDayIndicator: function (text) {
            this.$('.fixed-day-indicator').text(text);
            this.$('.fixed-day-indicator-wrap').removeClass('hidden');
        },

        showPinnedMessage: function (ev) {
            if ($(ev.target).hasClass('close'))
                this.unpinMessage();
            else {
                var pinned_message = this.contact.get('pinned_message'),
                    msg = this.buildMessageHtml(pinned_message),
                    pinned_msg_modal = new xabber.ExpandedMessagePanel({account: this.account, chat_content: this});
                pinned_msg_modal.$el.attr('data-color', this.account.settings.get('color'));
                this.updateMessageInChat(msg);
                this.initPopup(msg);
                pinned_msg_modal.open(msg);
            }
        },

        imageOnload: function ($message) {
            let $image_container = $message.find('.img-content'),
                $copy_link_icon = $message.find('.mdi-link-variant');
            $image_container.css('background-image', 'none');
            $copy_link_icon.attr({
                'data-image': 'true'
            });
        },

        unpinMessage: function () {
            var iq = $iq({from: this.account.get('jid'), type: 'set', to: this.contact.get('jid')})
                .c('update', {xmlns: Strophe.NS.GROUP_CHAT})
                .c('pinned-message');
            this.account.sendIQ(iq, function () {}, function (error) {
                if ($(error).find('error not-allowed').length)
                    utils.dialogs.error('You have no permission to pin/unpin message');
            });
        },

        hideHistoryFeedback: function () {
            this.$history_feedback.addClass('hidden');
        },

        receiveNoTextMessage: function ($message, carbon_copied) {
            var from_jid = Strophe.getBareJidFromJid($message.attr('from')),
                to_jid = Strophe.getBareJidFromJid($message.attr('to')),
                is_sender = from_jid === this.account.get('jid'),
                $chat_state = $message.find('[xmlns="'+Strophe.NS.CHATSTATES+'"]');
            if ($chat_state.length) {
                if (!is_sender) {
                    this.showChatState($chat_state[0].tagName.toLowerCase(), $chat_state.attr('type'));
                }
            }
        },

        showChatState: function (state, type) {
            clearTimeout(this._chatstate_show_timeout);
            var message, name = this.contact.get('name');
            if (state === 'composing') {
                if (type === 'audio') {
                    this._current_composing_msg = 'audio';
                    message = name + ' is recording audio message...';
                    this._chatstate_show_timeout = setTimeout(function () {
                        this.showChatState('paused', 'audio');
                    }.bind(this), constants.CHATSTATE_TIMEOUT_PAUSED_AUDIO);
                }
                else {
                    message = name + ' is typing...';
                    this._chatstate_show_timeout = setTimeout(function () {
                        this.showChatState('paused');
                    }.bind(this), constants.CHATSTATE_TIMEOUT_PAUSED);
                }
            } else if (state === 'paused') {
                if ((type === 'audio') || this._current_composing_msg === 'audio') {
                    this._current_composing_msg = undefined;
                    message = name + ' has stopped recording audio message...';
                }
                else
                    message = name + ' has stopped typing';
                this._chatstate_show_timeout = setTimeout(function () {
                    this.showChatState();
                }.bind(this), constants.CHATSTATE_TIMEOUT_STOPPED);
            } else {
                this.bottom.showChatNotification('');
                this.chat_item.updateLastMessage();
                return;
            }
            this.bottom.showChatNotification(message);
            this.chat_item.$('.last-msg').text(message);
            this.chat_item.$('.last-msg-date').text(utils.pretty_short_datetime())
                .attr('title', utils.pretty_datetime());
            this.chat_item.$('.msg-delivering-state').addClass('hidden');
        },

        onMessage: function (message) {
            let scrolled_from_bottom = this.getScrollBottom();
            this.account.messages.add(message);
            if (!_.isUndefined(message.get('is_accepted'))) {
                this.model.set('is_accepted', false);
            }
            this.model.set('opened', true);
            if (!message.get('is_archived') && message.get('archive_id')) {
                this.model.set('last_archive_id', message.get('archive_id'));
            }

            var is_scrolled_to_bottom = this.isScrolledToBottom();
            var $message = this.addMessage(message);

            if (message.get('type') === 'file_upload') {
                this.startUploadFile(message, $message);
            }

            if (is_scrolled_to_bottom || message.get('submitted_here')) {
                this.scrollToBottom();
            } else {
                this.updateScrollBar();
                this.scrollTo(this.ps_container[0].scrollHeight - this.ps_container[0].offsetHeight - scrolled_from_bottom);
            }

            if (!(message.get('is_archived') || message.isSenderMe() || message.get('silent') || ((message.get('type') === 'system') && !message.get('auth_request')))) {
                message.set('is_unread', !(this.model.get('display') && xabber.get('focused')));
                if (!message.get('is_unread'))
                    this.model.sendMarker(message.get('msgid'), 'displayed');
                if (!xabber.get('focused')) {
                    if (this.contact.get('muted')) {
                        message.set('muted', true);
                        if (this.contact.get('archived'))
                            message.set('archived', true);
                    }
                    else {
                        if (this.contact.get('archived')) {
                            this.head.archiveChat();
                            this.contact.set('archived', false);
                        }
                        this.notifyMessage(message);
                    }
                }
            }
            if (message.isSenderMe() && !message.get('is_archived')) {
                this.readMessages(message.get('timestamp'));
            }

            if ((this.model.get('active'))&&(message.get('invite') || message.get('auth_request'))) {
                this.model.contact.trigger('open_chat', this.model.contact);
            }

            let last_message = this.model.last_message;
            if (!last_message || message.get('timestamp') > last_message.get('timestamp')) {
                this.model.last_message = message;
                this.chat_item.updateLastMessage();
            }
        },

        addMessage: function (message) {
            if (message.get('auth_request')) {
                var idx_msg = this.model.messages.indexOf(message);
                this.model.messages.models.splice(idx_msg, 1);
                return;
            }
            var $message = this.buildMessageHtml(message);
            var index = this.model.messages.indexOf(message);
            if (index === 0) {
                $message.prependTo(this.$('.chat-content'));
            } else {
                $message.insertAfter(this.$('.chat-message').eq(index - 1));
            }
            var $next_message = $message.nextAll('.chat-message').first();
            this.updateMessageInChat($message[0]);
            if ($next_message.length) {
                this.updateMessageInChat($next_message[0]);
            }
            this.initPopup($message);
            return $message;
        },

        initPopup: function ($message) {
            var $one_image = $message.find('.uploaded-img'),
                $collage_image = $message.find('.uploaded-img-for-collage');
            if ($one_image.length) {
                $one_image.each(function (idx, item) {
                    this.initMagnificPopup($(item));
                }.bind(this));
            }
            if ($collage_image.length) {
                this.initZoomGallery($message);
            }
        },

        initMagnificPopup: function ($elem) {
            $elem.magnificPopup({
                type: 'image',
                closeOnContentClick: true,
                fixedContentPos: true,
                mainClass: 'mfp-no-margins mfp-with-zoom',
                image: {
                    verticalFit: true
                },
                zoom: {
                    enabled: true,
                    duration: 300
                }
            });
        },

        initZoomGallery: function ($message) {
            var self = this;
            $message.find('.zoom-gallery').magnificPopup({
                delegate: 'img',
                type: 'image',
                closeOnContentClick: false,
                closeBtnInside: false,
                mainClass: 'mfp-with-zoom mfp-img-mobile',
                image: {
                    verticalFit: true,
                    titleSrc: function(item) {
                        return '<a class="image-source-link" href="'+item.el.attr('src')+'" target="_blank">' + self.model.messages.getFilename(item.el.attr('src')) + '</a>';
                    }
                },
                gallery: {
                    enabled: true
                },
                zoom: {
                    enabled: true,
                    duration: 300,
                    opener: function(element) {
                        return element;
                    }
                }
            });
        },

        updateMessage: function (item) {
            let $message;
            if (item instanceof xabber.Message) {
                $message = this.$('.chat-message[data-msgid="' + item.get('msgid') + '"]');
            } else {
                return;
            }
            $message.children('.msg-wrap').children('.chat-msg-content').text(_.unescape(item.get('message')));
            let short_datetime = utils.pretty_short_datetime(item.get('last_replace_time')),
                datetime = utils.pretty_datetime(item.get('last_replace_time'));
            $message.find('.edited-info').removeClass('hidden').text('Edited at ' + short_datetime).prop('title', datetime);
            $message.hyperlinkify({selector: '.chat-text-content'}).emojify('.chat-text-content');
        },

        removeMessage: function (item) {
            var message, $message, $message_in_chat;
            if (item instanceof xabber.Message) {
                message = item;
                $message_in_chat = this.$('.chat-message[data-msgid="'+item.get('msgid')+'"]');
                (this.bottom.content_view) && ($message = this.bottom.content_view.$('.chat-message[data-msgid="'+item.get('msgid')+'"]'));
            } else {
                $message = item;
                if (!$message.length) return;
                message = this.model.messages.get($message.data('msgid'));
            }
            message && message.destroy();
            this.removeMessageFromDOM($message_in_chat);
            if ($message && ($message !== $message_in_chat))
                this.removeMessageFromDOM($message);
        },

        removeMessageFromDOM: function ($message) {
            if (($message.hasClass('with-author')) && (!$message.next().hasClass('with-author'))) {
                var avatar = $message.find('.circle-avatar').html();
                $message.next().addClass('with-author');
                $message.next().find('.circle-avatar').html(avatar);
            }
            $message.prev('.chat-day-indicator').remove();
            $message.remove();
            if (!this._clearing_history) {
                this.updateScrollBar();
            }
        },

        clearHistory: function () {
            this._clearing_history = true;
            _.each(_.clone(this.model.messages.models), this.removeMessage.bind(this));
            this._clearing_history = false;
            this.updateScrollBar();
        },

        isAudio: function(type) {
            if (type.indexOf('audio') != -1)
                return true;
            else
                return false;
        },

        renderVoiceMessage: function(element, file_url) {
            let not_expanded_msg = element.innerHTML,
                unique_id = 'waveform' + moment.now(),
                $elem = $(element),
                $msg_element = $elem.closest('.link-file');
            $elem.addClass('voice-message-rendering').html($(templates.messages.audio_file_waveform({waveform_id: unique_id})));
            let aud = this.createAudio(file_url, unique_id);

            aud.on('ready', function () {
                let duration = Math.round(aud.getDuration());
                $elem.find('.voice-msg-total-time').text(utils.pretty_duration(duration));
                aud.play();
            }.bind(this));

            aud.on('error', function () {
                $elem.removeClass('voice-message-rendering');
                element.innerHTML = not_expanded_msg;
                aud.unAll();
                $elem.find('.voice-message-play').get(0).remove();
                utils.callback_popup_message("This type of audio isn't supported in Your browser", 3000);
            }.bind(this));

            aud.on('play', function() {
                $msg_element.addClass('playing');
                let timerId = setInterval(function() {
                    let cur_time = Math.round(aud.getCurrentTime());
                    if (aud.isPlaying())
                        $elem.find('.voice-msg-total-time').text(utils.pretty_duration(cur_time));
                    else
                        clearInterval(timerId);
                }, 100);
            }.bind(this));

            aud.on('finish', function () {
                $msg_element.removeClass('playing');
            });

            aud.on('pause', function () {
                $msg_element.removeClass('playing');
            });

            this.$('.voice-message-volume')[0].onchange = function () {
                aud.setVolume(this.$('.voice-message-volume').val()/100);
            }.bind(this);
            return aud;
        },

        createImageGrid: function (attrs) {
            if (attrs.images.length > 6) {
                var tpl_name = 'template-for-6',
                    hidden_images = attrs.images.length - 5,
                    template_for_images = $(templates.messages[tpl_name](attrs));
                template_for_images.find('.last-image').addClass('hidden-images');
                template_for_images.find('.image-counter').text('+' + hidden_images);
            }
            else {
                var tpl_name = 'template-for-' + attrs.images.length,
                template_for_images = $(templates.messages[tpl_name](attrs));
            }
            return template_for_images;
        },

        buildMessageHtml: function (message, is_forwarded) {
            var attrs = _.clone(message.attributes),
                is_sender = (message instanceof xabber.Message) ? message.isSenderMe() : false,
                username = (attrs.from_nickname || ((attrs.from_jid == this.contact.get('jid')) ? this.contact.get('name') : (is_sender ? ((this.contact.my_info) ? this.contact.my_info.get('nickname') : this.account.get('name')) : ((this.account.contacts.get(attrs.from_jid) ? (this.account.contacts.get(attrs.from_jid).get('name')) : (attrs.from_jid)))))),
                images = attrs.images,
                files =  attrs.files,
                is_image = !_.isUndefined(images),
                is_file = (files) ? true : false,
                is_audio = false,
                template_for_images,
                avatar_id = attrs.from_avatar,
                role = attrs.role,
                badge = attrs.badge,
                from_id = attrs.from_id;

            if (is_sender && this.contact.get('group_chat')) {
                if (this.contact.my_info) {
                    role = this.contact.my_info.get('role');
                    badge = this.contact.my_info.get('badge');
                }
            }
            _.extend(attrs, {
                username: username,
                state: (message instanceof xabber.Message) ? message.getState() : 'sent',
                verbose_state: (message instanceof xabber.Message) ? message.getVerboseState() : 'sent',
                time: utils.pretty_datetime(attrs.time),
                short_time: utils.pretty_time(attrs.time),
                avatar_id: avatar_id,
                is_image: is_image,
                is_file: is_file,
                files: files,
                role: role,
                badge: badge,
                from_id: from_id
            });
            if (attrs.type === 'file_upload') {
                return $(templates.messages.file_upload(attrs));
            }

            if (attrs.type === 'system') {
                var tpl_name = attrs.auth_request ? ( attrs.invite ? 'group_request' : 'auth_request') : 'system';
                return $(templates.messages[tpl_name](attrs));
            }

            if (is_image) {
                if (images.length > 1) {
                    template_for_images = this.createImageGrid(attrs);
                }
            }

            var classes = [
                attrs.forwarded_message && 'forwarding'
            ];

            var $message = $(templates.messages.main(_.extend(attrs, {
                is_sender: is_sender,
                message: (is_image || is_file) ? "" : attrs.message ,
                classlist: classes.join(' ')
            })));

            if (is_image) {
                if (images.length > 1) {
                    $message.find('.chat-msg-content').removeClass('chat-text-content').html(template_for_images);
                }
                if (images.length == 1) {
                    var $img_html = this.createImage(images[0]),
                        img_content = this.createImageContainer(images[0]);
                    $img_html.onload = function () {
                        this.imageOnload($message);
                    }.bind(this);
                    $message.find('.chat-msg-content').removeClass('chat-text-content').html(img_content);
                    $message.find('.img-content').html($img_html);
                    this.updateScrollBar();
                }
            }

            if (is_file) {
                if (files.length > 0) {
                    var file_attrs = _.clone(files),
                        template_for_file_content;
                    $message.find('.chat-msg-content').removeClass('chat-text-content');
                    if (!is_image)
                        $message.find('.chat-msg-content').html('');
                    $(file_attrs).each(function(idx, file) {
                        if (file.type) {
                            if (this.isAudio(file.type))
                                is_audio = true;
                            else
                                is_audio = false;
                        }
                        _.extend(file_attrs[idx], { is_audio: is_audio, duration: file_attrs[idx].duration });
                        template_for_file_content = is_audio ? $(templates.messages.audio_file(file_attrs[idx])) : $(templates.messages.file(file_attrs[idx]));
                        $message.find('.chat-msg-content').append(template_for_file_content);
                    }.bind(this));
                    return $message;
                }
            }

            if (attrs.forwarded_message) {
                $(attrs.forwarded_message).each(function(idx, fwd_msg) {
                    is_sender = fwd_msg.isSenderMe();
                    attrs = _.clone(fwd_msg.attributes);
                    var is_image_forward = !_.isUndefined(attrs.images),
                        images_forward = is_image_forward ? _.clone(attrs.images) : undefined,
                        $img_html_forward,
                        is_forward_file = (attrs.files) ? true : false,
                        is_fwd_voice_message,
                        avatar_id = attrs.from_avatar,
                        role = attrs.role,
                        badge = attrs.badge,
                        from_id = attrs.from_id,
                        from_jid = attrs.from_jid;
                    if (is_sender) {
                        username = attrs.from_nickname || this.account.get('name');
                    } else {
                        username = attrs.from_nickname || attrs.from_id || this.account.contacts.mergeContact({jid: from_jid}).get('name');
                    }
                        var $f_message = $(templates.messages.forwarded(_.extend(attrs, {
                        time: utils.pretty_datetime(attrs.time),
                        short_time: utils.pretty_short_month_date(attrs.time),
                        username: username,
                        avatar_id: avatar_id,
                        message: (is_image_forward || is_forward_file) ? "" : attrs.message,
                        is_file: is_forward_file,
                        is_audio: is_fwd_voice_message,
                        role: role,
                        badge: badge,
                        from_id: from_id
                    })));

                    if (fwd_msg.get('forwarded_message')) {
                        var fwd_messages_count = fwd_msg.get('forwarded_message').length,
                            fwd_messages_link = fwd_messages_count + ' forwarded message' + ((fwd_messages_count > 1) ? 's' : "");
                        $f_message.children('.msg-wrap').children('.fwd-msgs-block').append($('<a/>', {class: 'collapsed-forwarded-message', 'data-msgid': attrs.msgid}).text(fwd_messages_link));
                    }

                    if (is_image_forward) {
                        if (images_forward.length > 1) {
                            template_for_images = this.createImageGrid(attrs);
                            $f_message.find('.chat-msg-content').removeClass('chat-text-content').html(template_for_images);
                        }
                        if (images_forward.length == 1) {
                            $img_html_forward = this.createImage(images_forward[0]);
                            $img_html_forward.onload = function () {
                                this.imageOnload($message);
                            }.bind(this);
                            var img_content_forward = this.createImageContainer(images_forward[0]);
                            $f_message.find('.chat-msg-content').removeClass('chat-text-content').html(img_content_forward);
                            $f_message.find('.img-content').html($img_html_forward);
                        }
                    }

                    if (is_forward_file) {
                        if (attrs.files.length > 0) {
                            $f_message.find('.chat-msg-content').removeClass('chat-text-content');
                            var file_attrs = _.clone(attrs.files),
                                template_for_file_content;
                            if (!is_image_forward)
                                $f_message.find('.chat-msg-content').html('');
                            $(file_attrs).each(function(idx, file) {
                                if (file.type) {
                                    if (this.isAudio(file.type))
                                        is_audio = true;
                                    else
                                        is_audio = false;
                                }
                                _.extend(file_attrs[idx], { is_audio: is_audio, duration: file_attrs[idx].duration });
                                template_for_file_content = is_audio ? $(templates.messages.audio_file(file_attrs[idx])) : $(templates.messages.file(file_attrs[idx]));
                                $f_message.find('.chat-msg-content').append(template_for_file_content);
                            }.bind(this));
                        }
                    }
                    $message.children('.msg-wrap').children('.fwd-msgs-block').append($f_message);
                }.bind(this));
                this.updateScrollBar();
            }
            else
                $message.find('.fwd-msgs-block').remove();

            return $message.hyperlinkify({selector: '.chat-text-content'}).emojify('.chat-text-content').emojify('.chat-msg-author-badge', {emoji_size: 14});
        },

        getDateIndicator: function (date) {
            var day_date = moment(date).startOf('day');
            return $('<div class="chat-day-indicator one-line noselect" data-time="'+
                day_date.format('x')+'">'+utils.pretty_date(day_date)+'</div>');
        },

        hideMessageAuthor: function ($msg) {
            $msg.removeClass('with-author');
        },

        showMessageAuthor: function ($msg) {
            if ($msg.hasClass('system')) {
                return;
            }
            $msg.addClass('with-author');
            let image, $avatar = $msg.find('.left-side .circle-avatar'),
                from_jid = $msg.data('from');
            if (from_jid === this.account.get('jid')) {
                if (this.contact.get('group_chat')) {
                    if (this.contact.my_info) {
                        image = this.contact.my_info.get('b64_avatar');
                        if (!image)
                            image = Images.getDefaultAvatar(this.contact.my_info.get('nickname'));
                        else
                            image = Images.getCachedImage(image);
                    }
                }
                if (!image)
                    image = this.account.cached_image;
            } else {
                if (this.contact.get('group_chat')) {
                    var author = $msg.find('.msg-wrap .chat-msg-author').text();
                    image = Images.getDefaultAvatar(author);
                }
                else {
                    var author = this.account.contacts.get($msg.data('from')) || $msg.find('.msg-wrap .chat-msg-author').text() || $msg.data('from');
                    image = author.cached_image || Images.getDefaultAvatar(author);
                }
            }
            $avatar.setAvatar(image, this.avatar_size);
            if ($msg.data('avatar')) {
                if ($msg.data('from-id')) {
                    if (this.account.chat_settings.getHashAvatar($msg.data('from-id')) == $msg.data('avatar') && (this.account.chat_settings.getB64Avatar($msg.data('from-id')))) {
                        $avatar.setAvatar(this.account.chat_settings.getB64Avatar($msg.data('from-id')), this.avatar_size);
                    }
                    else {
                        var node = Strophe.NS.PUBSUB_AVATAR_DATA + '#' + $msg.data('from-id');
                        this.contact.getAvatar($msg.data('avatar'), node, function (data_avatar) {
                            $avatar.setAvatar(data_avatar, this.avatar_size);
                            this.account.chat_settings.updateCachedAvatars($msg.data('from-id'), $msg.data('avatar'), data_avatar);
                        }.bind(this));
                    }
                }
            }
        },

        hideFwdMessageAuthor: function ($msg) {
            $msg.removeClass('with-author');
        },

        showFwdMessageAuthor: function ($fwd_message) {
            if (!$fwd_message.length) {
                return;
            }
            $fwd_message.addClass('with-author');
            var image,
                $avatar = $fwd_message.find('.circle-avatar'),
                from_jid = $fwd_message.data('from'),
                is_sender = (from_jid === this.account.get('jid')),
                contact = this.account.contacts.get(from_jid) || from_jid;
            if (is_sender) {
                if (this.contact.get('group_chat')) {
                    if (this.contact.my_info) {
                        image = this.contact.my_info.get('b64_avatar');
                        if (!image)
                            image = Images.getDefaultAvatar(this.contact.my_info.get('nickname'));
                        else
                            image = Images.getCachedImage(image);
                    }
                }
                if (!image)
                    image = this.account.cached_image;
            } else if (contact) {
                if (this.contact.get('group_chat')) {
                    var author = $fwd_message.find('.msg-wrap .fwd-msg-author').text();
                    image = Images.getDefaultAvatar(author);
                }
                else {
                    image = contact.cached_image || Images.getDefaultAvatar(contact);
                }
            }
            $avatar.setAvatar(image, this.avatar_size);
            $avatar.removeClass('hidden');
            if ($fwd_message.data('avatar')) {
                if ($fwd_message.data('from-id')) {
                    if ((this.account.chat_settings.getHashAvatar($fwd_message.data('from-id')) == $fwd_message.data('avatar')) && (this.account.chat_settings.getB64Avatar($fwd_message.data('from-id')))) {
                        $avatar.setAvatar(this.account.chat_settings.getB64Avatar($fwd_message.data('from-id')), this.avatar_size);
                    }
                    else {
                        var node = Strophe.NS.PUBSUB_AVATAR_DATA + '#' + $fwd_message.data('from-id');
                        this.contact.getAvatar($fwd_message.data('avatar'), node, function (data_avatar) {
                            $avatar.setAvatar(data_avatar, this.avatar_size);
                            this.account.chat_settings.updateCachedAvatars($fwd_message.data('from-id'), $fwd_message.data('avatar'), data_avatar);
                        }.bind(this));
                    }
                }
            }
        },

        updateMessageInChat: function (msg_elem) {
            var $msg = $(msg_elem);
            $msg.prev('.chat-day-indicator').remove();
            var $prev_msg = $msg.prevAll('.chat-message').first();
            if (!$prev_msg.length) {
                this.getDateIndicator($msg.data('time')).insertBefore($msg);
                this.showMessageAuthor($msg);
                $msg.find('.fwd-message').each(function (idx, fwd_msg_item) {
                    this.showFwdMessageAuthor($(fwd_msg_item));
                }.bind(this));
                return;
            }
            var is_system = $prev_msg.hasClass('system'),
                is_same_sender = ($msg.data('from') === $prev_msg.data('from')),
                is_same_date = moment($msg.data('time')).startOf('day')
                        .isSame(moment($prev_msg.data('time')).startOf('day'));
            if (!is_same_date) {
                this.getDateIndicator($msg.data('time')).insertBefore($msg);
                this.showMessageAuthor($msg);
            } else if (is_system || !is_same_sender) {
                this.showMessageAuthor($msg);
            } else {
                this.hideMessageAuthor($msg);
            }
            if ($msg.hasClass('forwarding')) {
                var $fwd_message = $msg.find('.fwd-message');
                $fwd_message.each(function (idx, fwd_msg_item) {
                    var $fwd_msg_item = $(fwd_msg_item),
                        $prev_fwd_message = (idx > 0) ? $fwd_msg_item.prev() : [];
                    $fwd_msg_item.switchClass('hide-date', is_same_date && $prev_fwd_message.length);
                    $fwd_msg_item.removeClass('hide-time');
                    if ($prev_fwd_message.length) {
                        var is_same_fwded_sender = ($fwd_msg_item.data('from') === $prev_fwd_message.data('from'));
                        if (is_same_fwded_sender) {
                            this.hideFwdMessageAuthor($fwd_msg_item);
                        } else {
                            this.showFwdMessageAuthor($fwd_msg_item);
                        }
                    } else {
                        this.showMessageAuthor($msg);
                        this.showFwdMessageAuthor($fwd_msg_item);
                    }
                }.bind(this));
            }
        },

        notifyMessage: function (message) {
            var jid = this.model.get('jid');
            if (xabber.settings.notifications) {
                var notification = xabber.popupNotification({
                    title: this.contact.get('name'),
                    text: (xabber.settings.message_preview ? message.getText() : 'sent you a message'),
                    icon: this.contact.cached_image.url
                });
                notification.onclick = function () {
                    window.focus();
                    this.model.trigger('open');
                }.bind(this);
            }
            if (xabber.settings.sound) {
                var sound;
                if (message.get('auth_request')) {
                    sound = xabber.settings.sound_on_auth_request;
                } else {
                    sound = xabber.settings.sound_on_message;
                }
                xabber.playAudio(sound);
            }
            xabber.recountAllMessageCounter();
        },

        sendMessage: function (message) {
            var body = _.unescape(message.get('message')),
                forwarded_message = message.get('forwarded_message');
            var msg_id = message.get('msgid'),
                stanza = $msg({
                    from: this.account.jid,
                    to: this.model.get('jid'),
                    type: 'chat',
                    id: msg_id
                });

            if (message.get('type') == 'file_upload') {
                var files = message.get('files'),
                    images = message.get('images');
                body = '';
                stanza.c('x', {xmlns: Strophe.NS.XFORM, type: 'form'});
                $(files).each(function(idx, file) {
                    let file_name = file.name,
                        file_size = file.size,
                        file_type = file.type,
                        file_duration = file.duration,
                        field_type = (file.voice) ? 'voice' : 'media',
                        file_uri = file.url;
                    body += file_uri;
                    if ((body != '') && ((idx != (files.length - 1)) || images.length))
                        body += '\n';
                    stanza.c('field', {var: 'media' + idx, type: field_type, label: file_name});
                    stanza.c('media', {xmlns: Strophe.NS.MEDIA});
                    if (file_duration)
                        stanza.c('uri', {type: file_type, size: file_size, duration: file_duration}).t(file_uri).up().up().up();
                    else
                        stanza.c('uri', {type: file_type, size: file_size}).t(file_uri).up().up().up();
                }.bind(this));
                $(images).each(function(idx, image) {
                    let file_name = image.name,
                        file_size = image.size,
                        file_type = image.type,
                        file_uri = image.url;
                    body += file_uri;
                    if ((body != '') && (idx != (images.length - 1)))
                        body += '\n';
                    stanza.c('field', {var: 'media' + idx, type: 'media', label: file_name});
                        var img_h = image.height,
                            img_w = image.width;
                        stanza.c('media', {xmlns: Strophe.NS.MEDIA, height: img_h, width: img_w});
                        stanza.c('uri', {type: file_type, size: file_size}).t(file_uri).up().up().up();
                }.bind(this));
                stanza.up();
                message.set({type: 'main'});
            }

            this.account._pending_messages.push({chat_hash_id: this.contact.hash_id, msg_id: msg_id});

            if (forwarded_message) {
                var forwarded_count = forwarded_message.length;
                $(forwarded_message).each(function (idx, fwd_msg) {
                    stanza.c('forwarded', {xmlns:'urn:xmpp:forward:0'})
                        .c('delay', {
                            xmlns: 'urn:xmpp:delay',
                            stamp: fwd_msg.get('time')
                        }).up().cnode(fwd_msg.get('xml')).up().up();
                }.bind(this));
                stanza.c('comment', { xmlns: 'xabber/comment'}).t(body).up();
                body = forwarded_count + ' forwarded ' + ((forwarded_count > 1) ? 'messages.' : 'message.') + ' Use advanced client like Xabber to view them.' + ((body) ? '\n' : "") + body;
            }

            stanza.c('body').t(body).up()
                .c('markable').attrs({'xmlns': Strophe.NS.CHAT_MARKERS}).up()
                .c('origin-id', {id: msg_id, xmlns: 'urn:xmpp:sid:0'}).up();
            if (this.contact.get('group_chat'))
                stanza.c('request', {xmlns: Strophe.NS.DELIVERY, to: this.model.get('jid')}).up();
            else
                stanza.c('request', {xmlns: Strophe.NS.DELIVERY}).up();
            message.set({xml: stanza.tree()});

            let msg_sending_timestamp = moment.now();
            this.account.sendMsg(stanza, function () {
                if (!this.contact.get('group_chat') && !this.account.server_features.find(feature => feature.get('var') === Strophe.NS.DELIVERY)) {
                    setTimeout(function () {
                        if ((this.account.last_stanza_timestamp > msg_sending_timestamp) && (message.get('state') === constants.MSG_PENDING)) {
                            message.set('state', constants.MSG_SENT);
                        } else {
                            this.account.connection.ping.ping(this.account.get('jid'), function () {
                                (message.get('state') === constants.MSG_PENDING) && message.set('state', constants.MSG_SENT);
                            }.bind(this));
                            setTimeout(function () {
                                if ((this.account.last_stanza_timestamp < msg_sending_timestamp) && (message.get('state') === constants.MSG_PENDING))
                                    message.set('state', constants.MSG_ERROR);
                            }.bind(this), 5000);
                        }
                    }.bind(this), 1000);
                }
                else {
                    let _pending_time = 5, _interval = setInterval(function () {
                        if ((this.account.last_stanza_timestamp < msg_sending_timestamp) && (message.get('state') === constants.MSG_PENDING) || (_pending_time > 60)) {
                            message.set('state', constants.MSG_ERROR);
                            clearInterval(_interval);
                        }
                        else if (message.get('state') !== constants.MSG_PENDING)
                            clearInterval(_interval);
                        _pending_time += 5;
                    }.bind(this), 5000);
                }
            }.bind(this));
        },

        isImageType: function(type) {
            if (type.indexOf('image') != -1)
                return true;
            else
                return false;
        },

        saveForwardedMessage: function (msg) {
            var forwarded_message = null;
            if ($(msg).get('forwarded_message')) {
                forwarded_message = $(msg).get('forwarded_message');
                if (this.account.forwarded_messages.indexOf(forwarded_message) < 0) {
                    forwarded_message = this.saveForwardedMessage(forwarded_message);
                }
            }
            msg = this.account.forwarded_messages.create(_.extend({
                is_forwarded: true,
                forwarded_message: forwarded_message
            }, msg.attributes));
            return msg;
        },

        onSubmit: function (text, fwd_messages) {
            // send forwarded messages before
            if (fwd_messages.length) {
                var new_fwd_messages = [];
                _.each(fwd_messages, function (msg) {
                    if (this.account.forwarded_messages.indexOf(msg) < 0) {
                        msg = this.saveForwardedMessage(msg);
                    }
                    new_fwd_messages.push(msg);
                }.bind(this));
                var message = this.model.messages.create({
                    from_jid: this.account.get('jid'),
                    message: text,
                    submitted_here: true,
                    forwarded_message: new_fwd_messages
                });
                this.sendMessage(message);
            } else if (text) {
                var message = this.model.messages.create({
                    from_jid: this.account.get('jid'),
                    message: text,
                    submitted_here: true,
                    forwarded_message: null
                });
                this.sendMessage(message);
            }
            if ((this.contact.get('archived'))&&(!this.contact.get('muted'))) {
                message.set('muted', false);
                this.head.archiveChat();
                this.contact.set('archived', false);
                xabber.chats_view.updateScreenAllChats();
            }
            if ((this.contact.get('group_chat'))&&(xabber.toolbar_view.$('.active').hasClass('chats')))
                if ((!this.contact.get('muted'))&&(!this.contact.get('archived')))
                    xabber.chats_view.updateScreenAllChats();
        },

        addFileMessage: function (files) {
            if (this.contact.messages_view)
                if (this.contact.messages_view.data.get('visible'))
                    this.contact.messages_view.openChat();
            if (files.length > 10) {
                utils.dialogs.error('You can`t upload more than 10 files');
                return;
            }
            var http_upload_service = this.account.server_features.get(Strophe.NS.HTTP_UPLOAD);
            if (!http_upload_service) {
                return;
            }
            var deferred_all = new $.Deferred();
            deferred_all.done(function (data) {
                this.model.messages.create({
                    from_jid: this.account.get('jid'),
                    type: 'file_upload',
                    files: data,
                    upload_service: http_upload_service.get('from'),
                    message: 'Uploading file',
                    submitted_here: true
                });
            }.bind(this));
            $(files).each(function(idx, file) {
                if (this.isImageType(file.type)) {
                    var reader = new FileReader(), deferred = new $.Deferred();
                    Images.compressImage(file).done(function (image) {
                        reader.readAsDataURL(image);
                        deferred.done(function (data) {
                            image.height = data.height;
                            image.width = data.width;
                            files[idx] = image;
                            if (idx === (files.length - 1))
                                deferred_all.resolve(files);
                        }.bind(this));
                    }.bind(this));
                    reader.onload = function (e) {
                        var image_prev = new Image();
                        image_prev.src = e.target.result;
                        image_prev.onload = function () {
                            var height = this.height,
                                width = this.width;
                            deferred.resolve({height: height, width: width});
                        }
                    };
                }
                else {
                    if (idx === (files.length - 1))
                        deferred_all.resolve(files);
                }
            }.bind(this));
        },

        startUploadFile: function (message, $message) {
            $message.emojify('.chat-msg-author-badge', {emoji_size: 14});
            $message.find('.cancel-upload').show();
            $message.find('.repeat-upload').hide();
            $message.find('.status').hide();
            $message.find('.progress').show();
            var files_count = 0;
            $(message.get('files')).each(function(idx, file) {
                var iq = $iq({type: 'get', to: message.get('upload_service')})
                        .c('request', {xmlns: Strophe.NS.HTTP_UPLOAD})
                        .c('filename').t(file.name).up()
                        .c('size').t(file.size).up()
                        .c('content-type').t(file.type).up(),
                    deferred = new $.Deferred(), self = this;
                this.account.sendIQ(iq,
                    function (result) {
                        var $slot = $(result).find('slot[xmlns="' + Strophe.NS.HTTP_UPLOAD + '"]');
                        deferred.resolve({
                            get_url: $slot.find('get').text(),
                            put_url: $slot.find('put').text()
                        });
                    },
                    function (err) {
                        var error_text = $(err).find('error text').text();
                        self.onFileNotUploaded(message, $message, error_text);
                    }
                );
                deferred.done(function (data) {
                    var xhr = new XMLHttpRequest(),
                        $bar = $message.find('.progress');
                    $message.find('.cancel-upload').click(function (ev) {
                        xhr.abort();
                    }.bind(this));
                    xhr.onabort = function (event) {
                        this.removeMessage($message);
                    }.bind(this);
                    xhr.upload.onprogress = function (event) {
                        var percentage = event.loaded / event.total;
                        $bar.find('.determinate').attr('style', 'width: ' + (100 * percentage) + '%');
                        $message.find('.filesize')
                            .text(utils.pretty_size(event.loaded) + ' of ' +
                                utils.pretty_size(event.total));
                    };
                    xhr.onload = xhr.onerror = function () {
                        if (this.status === 201) {
                            message.get('files')[idx].url = data.get_url;
                            files_count++;
                            if (files_count == message.get('files').length) {
                                self.onFileUploaded(message, $message);
                            }
                        } else {
                            self.onFileNotUploaded(message, $message, this.responseText);
                        }
                    };
                    if ($message.data('cancel')) {
                        xhr.abort();
                    } else {
                        xhr.open("PUT", data.put_url, true);
                        xhr.send(file);
                    }
                }.bind(this));
            }.bind(this));
        },

        onFileUploaded: function (message, $message) {
            var files = message.get('files'),
                self = this, is_audio = false,
                images = [], files_ = [], body_message = "";
            $(files).each(function(idx, file_) {
                var file_new_format = {
                    name: file_.name,
                    type: file_.type,
                    size: file_.size,
                    url: file_.url
                };
                body_message += file_new_format.url + "/n";
                if (this.isImageType(file_.type)) {
                    _.extend(file_new_format, { width: file_.width, height: file_.height });
                    images.push(file_new_format);
                }
                else {
                    _.extend(file_new_format, { duration: (file_.duration) ? utils.pretty_duration(file_.duration) : undefined });
                    files_.push(file_new_format);
                }
            }.bind(this));
            message.set('message', body_message);
            //  loaded and send image
            if (images.length > 0) {
                if (images.length > 1) {
                    if (images.length > 6) {
                        var tpl_name = 'template-for-6',
                            hidden_images = images.length - 5;
                        template_for_images = $(templates.messages[tpl_name]({images}));
                        template_for_images.find('.last-image').addClass('hidden-images');
                        template_for_images.find('.image-counter').text('+' + hidden_images);
                    }
                    else {
                        var tpl_name = 'template-for-' + images.length,
                            template_for_images = $(templates.messages[tpl_name]({images}));
                    }
                    $message.removeClass('file-upload noselect');
                    $message.find('.chat-msg-content').removeClass('chat-file-content').html(template_for_images);
                }
                else {
                    var img = this.createImage(images[0]),
                        img_content = self.createImageContainer(images[0]);
                    img.onload = function () {
                        this.imageOnload($message);
                    }.bind(this);
                    $message.removeClass('file-upload noselect');
                    $message.find('.chat-msg-content').removeClass('chat-file-content').html(img_content);
                    $message.find('.img-content').html(img);
                }
            }
            if (files_.length > 0) {
                $message.removeClass('file-upload noselect');
                $(files_).each(function (idx, item) {
                    if ((idx == 0)&&(images.length == 0))
                        $message.find('.chat-msg-content').removeClass('chat-file-content').html('');
                    if (item.type) {
                        if (this.isAudio(item.type))
                            is_audio = true;
                        else
                            is_audio = false;
                    }
                    let file_attrs = {
                            name: item.name,
                            type: item.type,
                            url: item.url
                        },
                        template_for_file_content;
                    _.extend(file_attrs, {size: utils.pretty_size(item.size), is_audio: is_audio, duration: item.duration });
                    template_for_file_content = is_audio ? $(templates.messages.audio_file(file_attrs)) : $(templates.messages.file(file_attrs));
                    $message.find('.chat-msg-content').append(template_for_file_content);
                }.bind(this));
            }
            this.initPopup($message);
            message.set('images', images);
            message.set('files', files_);
            this.sendMessage(message);
            this.scrollToBottom();
        },

        createAudio: function(file_url, unique_id) {
            var audio = WaveSurfer.create({
                container: "#" + unique_id,
                scrollParent: false,
                barWidth: 3,
                height: 48,
                barHeight: 48,
                cursorColor: 'rgba(211,47,47,0.8)',
                autoCenter: false,
                normalize: true,
                hideScrollBar: true,
                progressColor: '#757575'
            });
            audio.load(file_url);
            audio.setVolume(0.5);
            return audio;
        },

        createImage: function(image) {
            var imgContent = new Image(),
                maxHeight = 256,
                maxWidth = 300;
            if (image.height)
                imgContent.height = image.height;
            if (image.width)
                imgContent.width = image.width;
            imgContent.src = image.url;
            $(imgContent).addClass('uploaded-img popup-img');
            $(imgContent).attr('data-mfp-src', image.url);
            if ((imgContent.height)&&(imgContent.width)) {
                if (imgContent.width > maxWidth) {
                    imgContent.height = imgContent.height * (maxWidth/imgContent.width);
                    imgContent.width = maxWidth;
                }
                if (imgContent.height > maxHeight) {
                    imgContent.width = imgContent.width * (maxHeight/imgContent.height);
                    imgContent.height = maxHeight;
                }
            }
            return imgContent;
        },

        createImageContainer: function(image) {
            var imgContainer = document.createElement('div');
            $(imgContainer).addClass('img-content');
            return imgContainer;
        },

        onFileNotUploaded: function (message, $message, error_text) {
            var error_message = error_text ? 'Error: '+error_text : 'File uploading error';
            $message.find('.cancel-upload').hide();
            $message.find('.repeat-upload').show();
            $message.find('.status').text(error_message).show();
            $message.find('.progress').hide();
            $message.find('.repeat-upload').click(function () {
                this.startUploadFile(message, $message);
            }.bind(this));
        },

        sendChatState: function (state, type) {
            clearTimeout(this._chatstate_send_timeout);
            let stanza = $msg({'to': this.model.get('jid'), 'type': 'chat'});
            if (type)
                stanza.c(state, {'xmlns': Strophe.NS.CHATSTATES, 'type': type});
            else
                stanza.c(state, {'xmlns': Strophe.NS.CHATSTATES});
            this.account.sendMsg(stanza);
            if ((state === 'composing') && !type) {
                this._chatstate_send_timeout = setTimeout(function () {
                    this.bottom.chat_state = false;
                    this.sendChatState('paused');
                }.bind(this), constants.CHATSTATE_TIMEOUT_PAUSED);
            }
        },

        onChangedMessageState: function (message) {
            var $message = this.$('.chat-message[data-msgid="'+message.get('msgid')+'"]'),
                $elem = $message.find('.msg-delivering-state');
            $elem.attr({
                'data-state': message.getState(),
                'title': message.getVerboseState()
            });
            if (message === this.model.last_message) {
                this.chat_item.updateLastMessage();
            }
        },

        onChangedReadState: function (message) {
            var is_unread = message.get('is_unread');
            if (is_unread) {
                this.model.messages_unread.add(message);
                this.model.recountUnread();
            } else {
                this.model.messages_unread.remove(message);
                this.model.recountUnread();
                if (!message.get('muted')) {
                    xabber.recountAllMessageCounter();
                }
            }
        },

        onTouchMessage: function (ev) {
            if (ev.which === 3) {
                return;
            }
            var $elem = $(ev.target), $msg, msg,
                $fwd_message = $elem.parents('.fwd-message').first(),
                is_forwarded = $fwd_message.length > 0;

            if ($elem.hasClass('chat-message')) {
                $msg = $elem;
            } else {
                $msg = $elem.parents('.chat-message');
            }
            if (window.getSelection() != 0) {
                utils.clearSelection();
                $msg.attr('data-no-select-on-mouseup', '1');
            }
        },

        onClickLink: function (ev) {
            let $elem = $(ev.target),
                $message = $elem.closest('.chat-message'),
                msg = this.model.messages.get($message.data('msgid'));
            if (!msg) {
                msg = this.account.participant_messages.get($message.data('msgid'));
            }
            let files = msg.get('files'),
                images = msg.get('images'),
                fwd_messages = [],
                files_links = '';
            if (msg.get('forwarded_message')) {
                msg.get('forwarded_message').forEach(function (message) {
                    message.get('images') && fwd_messages.push(message.get('images'));
                }.bind(this));
            }
            $(files).each(function(idx, file) {
                if (idx > 0)
                    files_links += '\n';
                files_links += file.url;
            });
            $(images).each(function(idx, image) {
                if (idx > 0)
                    files_links += '\n';
                files_links += image.url;
            });
            $(fwd_messages).each(function (idx, message) {
                $(message).each(function (i, file) {
                    if (files_links != "")
                        files_links += '\n';
                    files_links += file.url;
                });
            });
            utils.copyTextToClipboard(files_links, 'Link copied to clipboard', 'ERROR: Link not copied to clipboard');
        },

        onClickMessage: function (ev) {
            let $elem = $(ev.target);
            if ($elem.hasClass('file-link-download')) {
                ev.preventDefault();
                xabber.openWindow($elem.attr('href'));
            }
            if ((!$elem.hasClass('mdi-link-variant'))&&(!$elem.hasClass('file-link-download'))&&(!$elem.is('canvas'))&&(!$elem.hasClass('voice-message-volume'))) {
            var $msg = $elem.closest('.chat-message'), msg,
                $fwd_message = $elem.parents('.fwd-message').first(),
                is_forwarded = $fwd_message.length > 0,
                no_select_message = $msg.attr('data-no-select-on-mouseup');
            $msg.attr('data-no-select-on-mouseup', '');
            if (window.getSelection() != 0) {
                return;
            }
                if ($elem.hasClass('collapsed-forwarded-message')) {
                    let msg = this.buildMessageHtml(this.account.forwarded_messages.get($elem.data('msgid'))),
                        expanded_fwd_message = new xabber.ExpandedMessagePanel({account: this.account, chat_content: this});
                    expanded_fwd_message.$el.attr('data-color', this.account.settings.get('color'));
                    this.updateMessageInChat(msg);
                    this.initPopup(msg);
                    expanded_fwd_message.open(msg);
                    return;
                }

            if ($elem.hasClass('chat-msg-author') || $elem.hasClass('fwd-msg-author')) {
                let from_jid = is_forwarded ? $fwd_message.data('from') : $msg.data('from'),
                    from_id = is_forwarded ? $fwd_message.data('fromId') : $msg.data('fromId');
                if (this.contact.get('group_chat')) {
                    if (this.contact.get('group_info')) {
                        let participant = this.contact.participants.get(from_id),
                            participant_attrs = ((participant && participant.attributes) || {jid: from_jid, id: from_id, nickname: $elem.text()});
                        this.contact.messages_view = new xabber.ParticipantMessagesView({
                            contact: this.contact,
                            model: participant_attrs
                        });
                        this.contact.messages_view.messagesRequest({}, function () {
                            xabber.body.setScreen('all-chats', {
                                right: 'participant_messages',
                                contact: this.contact
                            });
                        }.bind(this));
                    }
                }
                else if (from_jid === this.account.get('jid')) {
                    this.account.showSettings();
                } else if (from_jid === this.model.get('jid')) {
                    this.contact.showDetails('all-chats');
                } else {
                    var contact = this.account.contacts.mergeContact(from_jid);
                    contact.showDetails();
                }
                return;
            }

            if ($elem.parent().hasClass('circle-avatar')) {
                let from_jid = is_forwarded ? $fwd_message.data('from') : $msg.data('from');
                if (this.contact.get('group_chat')) {
                    let rights_model = this.contact.details_view,
                        $rights_elem = new xabber.ParticipantRightsModal({account: this.account}),
                        member_id = (is_forwarded) ? $fwd_message.attr('data-from-id') : $msg.attr('data-from-id'),
                        rights_panel = new xabber.ParticipantPropertiesView({model: rights_model, el: $rights_elem.$el[0], modal_window: $rights_elem}),
                        iq_member_info = $iq({from: this.account.get('jid'), type: 'get', to: this.contact.get('jid') })
                            .c('query', {xmlns: Strophe.NS.GROUP_CHAT + '#members', id: member_id});
                    if (member_id) {
                        if (!this.contact.all_rights)
                            this.contact.getAllRights();
                        let this_member = this.contact.participants.get(member_id);
                        if (this_member) {
                            $rights_elem.open();
                            rights_panel.render(this_member);
                        }
                        else
                            this.account.sendIQ(iq_member_info, function (iq) {
                                let this_member = this.contact.participants.createFromStanza($(iq).find('item'));
                                $rights_elem.open();
                                rights_panel.render(this_member);
                            }.bind(this));
                    }
                    return;
                }
                else if (from_jid === this.account.get('jid')) {
                    this.account.showSettings();
                } else if (from_jid === this.model.get('jid')) {
                    this.contact.showDetails('all-chats');
                } else {
                    let contact = this.account.contacts.mergeContact(from_jid);
                    contact.showDetails();
                }
                return;
            }

            if ($elem.hasClass('voice-message-play') || $elem.hasClass('no-uploaded')) {
                let $audio_elem = $elem.closest('.link-file'),
                    f_url = $audio_elem.find('.file-link-download').attr('href');
                $audio_elem.find('.mdi-play').removeClass('no-uploaded');
                $audio_elem[0].voice_message = this.renderVoiceMessage($audio_elem.find('.file-container')[0], f_url);
                this.prev_audio_message && this.prev_audio_message.voice_message.pause();
                this.prev_audio_message = $audio_elem[0];
                return;
            }

            if ($elem.hasClass('mdi-play')) {
                let $audio_elem = $elem.closest('.link-file');
                this.prev_audio_message.voice_message.pause();
                this.prev_audio_message = $audio_elem[0];
                $audio_elem[0].voice_message.play();
                return;
            }

            if ($elem.hasClass('mdi-pause')) {
                this.prev_audio_message.voice_message.pause();
                return;
            }

            if ($elem.hasClass('msg-hyperlink')) {
                return;
            }

            if ($elem.hasClass('uploaded-img')||($elem.hasClass('uploaded-img-for-collage'))) {
                return;
            }

            if ($elem.hasClass('last-image')) {
                $elem.find('img')[0].click();
                return;
            }

            if ($elem.hasClass('image-counter')) {
                $elem.closest('.last-image').find('img')[0].click();
                return;
            }

            if ($msg.hasClass('participant-message') && $elem.hasClass('get-context-icon')) {
                this.model.getMessageContext($msg.data('msgid'));
                return;
            }

            let processClick = function () {
                if (!no_select_message) {
                    $msg.switchClass('selected', !$msg.hasClass('selected'));
                    this.bottom.manageSelectedMessages();
                }
            }.bind(this);

            if ($msg.hasClass('participant-message')) {
                processClick();
                return;
            }

            msg = this.model.messages.get($msg.data('msgid'));
            if (!msg) {
                return;
            }

            var type = msg.get('type');
            if (type === 'file_upload') {
                return;
            }

            if (type === 'system') {
                if (!msg.get('auth_request')) {
                    return;
                }
                if ($elem.hasClass('accept-request')) {
                    this.contact.acceptRequest(function () {
                        this.removeMessage($msg);
                        this.contact.showDetails('all-chats');
                    }.bind(this));
                } else if ($elem.hasClass('block-request')) {
                    this.contact.blockRequest(function () {
                        this.removeMessage($msg);
                    }.bind(this));
                } else if ($elem.hasClass('decline-request')) {
                    this.contact.declineRequest(function () {
                        this.removeMessage($msg);
                        this.model.set('active', false);
                        this.head.closeChat();
                        xabber.body.setScreen('all-chats', {right: null});
                    }.bind(this));
                }

                if ($elem.hasClass('accept-request-group')) {
                    this.contact.acceptGroupRequest(function () {
                        this.removeMessage($msg);
                        this.contact.set('in_roster', true);
                        this.contact.trigger("open_chat", this.model);
                    }.bind(this));
                } else if ($elem.hasClass('block-request-group')) {
                    this.contact.blockRequest(function () {
                        this.removeMessage($msg);
                    }.bind(this));
                } else if ($elem.hasClass('decline-request-group')) {
                    this.contact.declineRequest(function () {
                        this.removeMessage($msg);
                        this.model.set('active', false);
                        this.head.closeChat();
                        xabber.body.setScreen('all-chats', {right: null});
                    }.bind(this));
                }
            } else if (is_forwarded) {
                var fwd_message = this.account.forwarded_messages.get($fwd_message.data('msgid'));
                if (!fwd_message) {
                    return;
                }
                processClick();
            } else {
                processClick();
            }
            }
        }
    });

    xabber.ParticipantRightsModal = xabber.BasicView.extend({
        className: 'modal participant-rights-panel',

        events: {
            "click .btn-escape": "close"
        },

        _initialize: function (options) {
            this.account = options.account;
        },

        open: function () {
            this.$el.openModal({
                ready: function () {
                    this.updateScrollBar();
                }.bind(this),
                complete: function () {
                    this.$el.detach();
                    this.data.set('visible', false);
                }.bind(this)
            });
        },

        close: function () {
            var deferred = new $.Deferred();
            this.$el.closeModal({ complete: function () {
                    this.$el.detach();
                    this.data.set('visible', false);
                    deferred.resolve();
                }.bind(this)});
            return deferred.promise();
        }
    });

    xabber.ExpandedMessagePanel = xabber.BasicView.extend({
        className: 'modal expanded-message',
        template: templates.group_chats.pinned_message_panel,
        ps_selector: '.modal-content',
        ps_settings: {theme: 'item-list'},

        events: {
            "click .close": "close",
            "click .collapsed-forwarded-message": "expandFwdMessage"
        },

        _initialize: function (options) {
            this.account = options.account;
            this.chat_content = options.chat_content;
        },

        open: function ($message) {
            this.$el.openModal({
                ready: function () {
                    this.updateScrollBar();
                    this.$('.modal-content').css('height', this.$el.height() - 20);
                }.bind(this),
                complete: function () {
                    this.$el.detach();
                    this.data.set('visible', false);
                }.bind(this)
            });
            $message.find('.right-side .msg-delivering-state').remove();
            this.$('.modal-content').html($message);
            this.$('.msg-copy-link').remove();
        },

        close: function () {
            this.$el.closeModal({ complete: this.hide.bind(this) });
        },

        expandFwdMessage: function (ev) {
            var $target = $(ev.target),
                msgid = $target.data('msgid'),
                msg = this.chat_content.buildMessageHtml(this.account.forwarded_messages.get(msgid)),
                expanded_fwd_message = new xabber.ExpandedMessagePanel({account: this.account, chat_content: this.chat_content});
            expanded_fwd_message.$el.attr('data-color', this.account.settings.get('color'));
            this.chat_content.updateMessageInChat(msg);
            this.chat_content.initPopup(msg);
            expanded_fwd_message.open(msg);
        }
    });

    xabber.ChatsBase = Backbone.Collection.extend({
        model: xabber.Chat
    });

    xabber.Chats = xabber.ChatsBase.extend({
        initialize: function (models, options) {
            this.collections = [];
            this.on("add", _.bind(this.updateInCollections, this, 'add'));
            this.on("change", _.bind(this.updateInCollections, this, 'change'));
        },

        addCollection: function (collection) {
            this.collections.push(collection);
        },

        updateInCollections: function (event, contact) {
            _.each(this.collections, function (collection) {
                collection.update(contact, event);
            });
        }
    });

    xabber.OpenedChats = xabber.ChatsBase.extend({
        comparator: function (item1, item2) {
            var t1 = item1.get('timestamp'),
                t2 = item2.get('timestamp');
            return t1 > t2 ? -1 : (t1 < t2 ? 1 : 0);
        },

        initialize: function (models, options) {
            this.on("change:timestamp", this.sort, this);
        },

        update: function (chat, event) {
            var contains = chat.get('opened');
            if (contains) {
                if (!this.get(chat)) {
                    this.add(chat);
                    chat.trigger("add_opened_chat", chat);
                }
            } else if (this.get(chat)) {
                this.remove(chat);
                chat.trigger("remove_opened_chat", chat);
            }
        }
    });

    xabber.ClosedChats = xabber.ChatsBase.extend({
        update: function (chat, event) {
            var contains = !chat.get('opened');
            if (contains) {
                if (!this.get(chat)) {
                    this.add(chat);
                    chat.trigger("add_closed_chat", chat);
                }
            } else if (this.get(chat)) {
                this.remove(chat);
                chat.trigger("remove_closed_chat", chat);
            }
        }
    });

    xabber.AccountChats = xabber.ChatsBase.extend({
        initialize: function (models, options) {
            this.account = options.account;
            this.mam_requests = 0;
            this.deferred_mam_requests = [];
            this.account.contacts.on("add_to_roster", this.getChat, this);
            this.account.contacts.on("open_chat", this.openChat, this);
            this.account.contacts.on("presence", this.onPresence, this);
        },

        getChat: function (contact) {
            var chat = this.get(contact.hash_id);
            if (!chat) {
                chat = xabber.chats.create(null, {contact: contact});
                this.add(chat);
                contact.set('known', true);
            }
            return chat;
        },

        openChat: function (contact) {
            var chat = this.getChat(contact);
            chat.trigger('open', {clear_search: true});
        },

        registerMessageHandler: function () {
            this.account.connection.deleteHandler(this._msg_handler);
            this._msg_handler = this.account.connection.addHandler(function (message) {
                this.receiveMessage(message);
                return true;
            }.bind(this), null, 'message');
        },

        onStartedMAMRequest : function (deferred) {
            this.deferred_mam_requests.push(deferred);
            this.runMAMRequests();
        },

        onCompletedMAMRequest: function (deferred) {
            this.mam_requests--;
            this.runMAMRequests();
        },

        runMAMRequests: function () {
            while (this.mam_requests < xabber.settings.mam_requests_limit) {
                var deferred = this.deferred_mam_requests.shift();
                if (!deferred) break;
                this.mam_requests++;
                deferred.resolve();
            }
        },

        setArchiveId: function ($message) {
            var origin_id = $message.children('origin-id').attr('id'),
                pending_message = this.account._pending_messages.find(msg => msg.msg_id === origin_id);
            if (pending_message) {
                this.account.chats.get(pending_message.chat_hash_id).messages.get(pending_message.msg_id).set('archive_id', $message.children('stanza-id').attr('id'));
                this.account._pending_messages.splice(this.account._pending_messages.indexOf(pending_message), 1);
            }
        },

        parsePubSubNode: function (node) {
            if (!node)
                return null;
            var is_member_id = node.indexOf('#');
            if (is_member_id !== -1)
                return node.slice(is_member_id + 1, node.length);
            else
                return null;
        },

        receivePubsubMessage: function ($message) {
            var photo_id =  $message.find('info').attr('id'),
                node = $message.find('items').attr('node'),
                member_id = this.parsePubSubNode(node),
                contact = this.account.contacts.get(Strophe.getBareJidFromJid($message.attr('from')));
            if (contact) {
                if (member_id) {
                    if (contact.my_info) {
                        if ((member_id == contact.my_info.get('id')) && (photo_id == contact.my_info.get('avatar'))) {
                            return;
                        }
                    }
                    if ((photo_id) && (this.account.chat_settings.getHashAvatar(member_id) != photo_id)) {
                        var member_node = Strophe.NS.PUBSUB_AVATAR_DATA + '#' + member_id;
                        contact.getAvatar(photo_id, member_node, function (new_avatar) {
                            this.account.chat_settings.updateCachedAvatars(member_id, photo_id, new_avatar);
                            if (contact.my_info) {
                                if (member_id == contact.my_info.id) {
                                    contact.my_info.set({avatar: photo_id, b64_avatar: new_avatar });
                                }
                            }
                        }.bind(this));
                    }
                }
                else {
                    if ((photo_id !== "") && (contact.get('hash_avatar') === photo_id))
                        return;
                    else {
                        contact.set('hash_avatar', photo_id);
                        contact.getAvatar(photo_id, Strophe.NS.PUBSUB_AVATAR_DATA, function (data_avatar) {
                            contact.cached_image = Images.getCachedImage(data_avatar);
                            contact.set('image', data_avatar);
                        });
                    }
                }
            }
        },

        receiveMessage: function (message) {
            var $message = $(message),
                type = $message.attr('type');
            if (type === 'headline') {
                return this.receiveHeadlineMessage(message);
            }
            if (type === 'chat' || (type === 'normal')) {
                return this.receiveChatMessage(message);
            }
            if (type === 'error') {
                return this.receiveErrorMessage(message);
            }
        },

        receiveHeadlineMessage: function (message) {
            var $message = $(message),
                msg_from = Strophe.getBareJidFromJid($message.attr('from')),
                $stanza_received = $message.find('received[xmlns="' + Strophe.NS.DELIVERY + '"]');
            if ($stanza_received.length) {
                let $received_message = $stanza_received.children('forwarded').children('message'),
                    origin_msg_id = $stanza_received.children('origin-id').first().attr('id') || $received_message.children('origin-id').first().attr('id');
                if ($received_message.length) {
                    if (!this.account.messages.get($received_message.children('origin-id').attr('id')))
                        return this.receiveChatMessage($received_message[0], {echo_msg: true});
                }
                if (origin_msg_id) {
                    this.account.messages.get(origin_msg_id).set('state', constants.MSG_SENT);
                    let contact = this.account.contacts.get(msg_from);
                    if (contact) {
                        if (contact.get('group_chat')) {
                            if ($received_message.children('stanza-id').attr('by') == contact.get('jid')) {
                                let from_id = $received_message.children('x[xmlns="' + Strophe.NS.GROUP_CHAT + '"]').find('user').attr('id');
                                this.setArchiveId($received_message);
                                this.account.messages.get(origin_msg_id).set({state: constants.MSG_DISPLAYED, from_id: from_id});
                                let $groupchat = this.account.chats.getChat(contact);
                                from_id && $groupchat.item_view.content.$el.find('.chat-message[data-msgid="' + origin_msg_id + '"]').attr('data-from-id', from_id);
                            }
                        }
                        else
                            this.setArchiveId($stanza_received);
                    }
                }
                return;
            }

            if ($message.find('event[xmlns="' + Strophe.NS.PUBSUB + '#event"]').length) {
                this.receivePubsubMessage($message);
                return;
            }

            let contact = this.account.contacts.get(msg_from), chat;
            contact && (chat = this.account.chats.getChat(contact));

            if ($message.find('replace').length) {
                var stanza_id = $message.find('replace').attr('id'),
                    msg_item = chat.messages.find(msg => msg.get('archive_id') == stanza_id),
                    participant_msg_item = (this.account.participant_messages) ? (this.account.participant_messages.find(msg => msg.get('archive_id') == stanza_id)) : null,
                    new_text = _.escape($message.find('replace message body').text());
                if (participant_msg_item) {
                    participant_msg_item.set('message', new_text);
                    participant_msg_item.set('last_replace_time', $message.find('replaced').attr('stamp'));
                }
                if (msg_item) {
                    msg_item.set('message', new_text);
                    msg_item.set('last_replace_time', $message.find('replaced').attr('stamp'));
                    if (contact.get('pinned_message'))
                        if (contact.get('pinned_message').get('msgid') === msg_item.get('msgid')) {
                            contact.get('pinned_message').set('message', new_text);
                            chat.item_view.content.updatePinnedMessage();
                        }
                    chat.item_view.updateLastMessage(chat.last_message);
                }
            }
            if ($message.find('retract-message').length) {
                var $retracted_msg = $message.find('retract-message'),
                    retracted_msg_id = $retracted_msg.attr('id'),
                    msg_item = chat.messages.find(msg => msg.get('archive_id') == retracted_msg_id);
                if (msg_item) {
                    msg_item.set('is_unread', false);
                    chat.item_view.content.removeMessage(msg_item);
                    chat.item_view.updateLastMessage(chat.last_message);
                }
                if ($retracted_msg.attr('version') > contact.message_retraction_version)
                    contact.message_retraction_version = $retracted_msg.attr('version');
            }
            if ($message.find('retract-user').length) {
                var $retracted_user_msgs = $message.find('retract-user'),
                    retracted_user_id = $retracted_user_msgs.attr('id'),
                    msg_item = chat.messages.filter(msg => msg.get('from_id') == retracted_user_id);
                if (msg_item)
                    $(msg_item).each(function (idx, item) {
                        item.set('is_unread', false);
                        chat.item_view.content.removeMessage(item);
                    }.bind(this));
                chat.item_view.updateLastMessage(chat.last_message);
            }
            if ($message.find('retract-all').length) {
                var all_messages = chat.messages.models;
                $(all_messages).each(function (idx, item) {
                    chat.item_view.content.removeMessage(item);
                }.bind(this));
                chat.item_view.content.head.closeChat();
            }
            if ($message.find('confirm[xmlns="' + Strophe.NS.HTTP_AUTH + '"]').length) {
                let code =  $message.find('confirm').attr('id');
                if (($message.attr('from') == this.account.xabber_auth.api_jid) && ($message.attr('id') == this.account.xabber_auth.request_id)) {
                    this.account.verifyXabberAccount(code, function (data) {
                        if (this.account.get('auto_login_xa')) {
                            xabber.api_account.save('token', data);
                            xabber.api_account.login_by_token();
                        }
                    }.bind(this));
                }
                else {
                    return this.receiveChatMessage(message);
                }
            }
            return;
        },

        receiveChatMessage: function (message, options) {
            options = options || {};
            var $message = $(message),
                $forwarded = $message.find('forwarded'),
                $delay = options.delay,
                to_jid = $message.attr('to'),
                to_bare_jid = Strophe.getBareJidFromJid(to_jid),
                to_resource = Strophe.getResourceFromJid(to_jid),
                from_jid = $message.attr('from') || options.from_jid;

            if ($message.find('invite').length) {
                if (options.forwarded)
                    return;
            }

            if (!from_jid) {
                xabber.warn('Message without "from" attribute');
                xabber.warn(message);
                return;
            }
            var from_bare_jid = Strophe.getBareJidFromJid(from_jid),
                is_sender = from_bare_jid === this.account.get('jid');

            if (options.forwarded && (!$forwarded.length || (options.xml))) {
                return this.account.forwarded_messages.createFromStanza($message, {
                    is_forwarded: true,
                    forwarded_message: options.forwarded_message || null,
                    delay: $delay,
                    from_jid: from_jid,
                    xml: options.xml
                });
            }

            if (($forwarded.length)&&(!(options.xml))) {
                var $mam = $message.find('result[xmlns="'+Strophe.NS.MAM+'"]');
                if ($mam.length) {
                    $forwarded = $mam.children('forwarded');
                    var $stanza_id = ($message.find('x[xmlns="' + Strophe.NS.GROUP_CHAT + '"]').length) ? $message.find('stanza-id[by="' + from_bare_jid + '"]') : $message.find('stanza-id'),
                        $archived = $message.find('archived'),
                        archive_id;
                    if ($stanza_id.length) {
                        archive_id = $stanza_id.attr('id');
                    } else if ($archived.length) {
                        archive_id = $archived.attr('id');
                    }
                    archive_id = archive_id || $mam.attr('id');
                    if ($forwarded.length) {
                        $message = $forwarded.children('message');
                        $delay = $forwarded.children('delay');
                    }
                    return this.receiveChatMessage($message[0], _.extend(options, {
                        is_mam: true,
                        delay: $delay,
                        archive_id: archive_id
                    }));
                }
                var $carbons = $message.find('[xmlns="'+Strophe.NS.CARBONS+'"]');
                if ($carbons.length) {
                    if ((!is_sender) || (is_sender && $message.find('invite').length)) {
                        return;
                    }
                    $forwarded = $carbons.children('forwarded');
                    if ($forwarded.length) {
                        $message = $forwarded.children('message');
                    }
                    if ($carbons.find('request[xmlns="' + Strophe.NS.DELIVERY + '"][to="' + to_bare_jid + '"]').length)
                        return;
                    return this.receiveChatMessage($message[0], _.extend(options, {
                        carbon_copied: true
                    }));
                }
                var $forwarded_msgs = [];
                $forwarded = $message.children('forwarded');
                $forwarded.each(function (idx, forwarded_msg) {
                    var $forwarded_msg = $(forwarded_msg),
                        $forwarded_message = $forwarded_msg.children('message'),
                        $forwarded_delay = $forwarded_msg.children('delay');
                    var forwarded_message = this.receiveChatMessage($forwarded_message[0], {
                        forwarded: true,
                        pinned_message: options.pinned_message,
                        participant_message: options.participant_message,
                        searched_message: options.searched_message,
                        context_message: options.context_message,
                        from_jid: from_jid,
                        delay: $forwarded_delay
                    });
                    $forwarded_msgs.push(forwarded_message);
                }.bind(this));
                return this.receiveChatMessage($message[0], _.extend({
                    forwarded_message: $forwarded_msgs,
                    xml: $message[0]
                }, options));
            }

            if (!options.is_mam && to_resource && to_resource !== this.account.resource) {
                xabber.warn('Message to another resource');
                xabber.warn(message);
            }

            var contact_jid = is_sender ? to_bare_jid : from_bare_jid;

            if (contact_jid === this.account.get('jid')) {
                xabber.warn('Message from me to me');
                xabber.warn(message);
                return;
            }

            var contact = this.account.contacts.mergeContact(contact_jid),
                chat = this.account.chats.getChat(contact);

            if ($message.find('x[xmlns="' + Strophe.NS.AUTH_TOKENS + '"]').length) {
                this.account.getAllXTokens();
                if (!contact.get('in_roster'))
                    contact.pushInRoster();
            }

            return chat.receiveMessage($message, _.extend(options, {is_sender: is_sender}));
        },

        receiveErrorMessage: function (message) {
            var msgid = message.getAttribute('id');
            if (msgid) {
                var code = $(message).find('error').attr('code');
                var msg = this.account.messages.get(msgid);
                if (msg && code === '406') {
                    msg.set('state', constants.MSG_ERROR);
                }
            }
        },

        onPresence: function (contact, type) {
            var chat = this.getChat(contact);
            chat.onPresence(type);
        }
    });

    xabber.AddGroupChatView = xabber.SearchView.extend({
        className: 'modal main-modal add-group-chat-modal add-contact-modal',
        template: templates.group_chats.add_group_chat,
        avatar_size: constants.AVATAR_SIZES.ACCOUNT_ITEM,
        ps_selector: '.rich-textarea',
        ps_settings: {theme: 'item-list'},

        events: {
            "click .account-field .dropdown-content": "selectAccount",
            "click .btn-add": "addGroupChat",
            "keyup .input-group-chat-name input": "updateGroupJid",
            "keyup .rich-textarea": "showPlaceholder",
            "keyup .input-group-chat-jid input": "fixJid",
            "click .btn-cancel": "close",
            "click .property-variant": "changePropertyValue"
        },

        render: function (options) {
            if (!xabber.accounts.connected.length) {
                utils.dialogs.error('No connected accounts found.');
                return;
            }
            options || (options = {});
            this.$('input[name=chat_jid]').removeClass('fixed-jid').val("");
            this.$('#new_chat_domain').val("");
            this.$('input[name=chat_name]').val("");
            this.$('.description-field .rich-textarea').text("");
            this.$('.btn-add').addClass('non-active');
            this.showPlaceholder();
            this.$('span.errors').text('').addClass('hidden');
            var accounts = options.account ? [options.account] : xabber.accounts.connected,
                jid = options.jid || '';
            this.$('.single-acc').showIf(accounts.length === 1);
            this.$('.multiple-acc').hideIf(accounts.length === 1);
            this.$('.account-field .dropdown-content').empty();
            _.each(accounts, function (account) {
                this.$('.account-field .dropdown-content').append(
                        this.renderAccountItem(account));
            }.bind(this));
            this.bindAccount(accounts[0]);
            var name = this.$('input[name=chat_name]').val(),
                contact, error_text;
            this.$('.btn-cancel').text(this.is_login ? 'Skip' : 'Cancel');
            this.$el.openModal({
                ready: function () {
                    let dropdown_settings = {
                        inDuration: 100,
                        outDuration: 100,
                        constrainWidth: false,
                        hover: false,
                        alignment: 'left'
                    };
                    Materialize.updateTextFields();
                    this.$('.account-field .dropdown-button').dropdown(dropdown_settings);
                    this.$('.property-field .dropdown-button').dropdown(dropdown_settings);
                    this.$('.property-field .select-xmpp-server .caret').dropdown(dropdown_settings);
                    this.$('.property-field .select-xmpp-server .xmpp-server-item-wrap').dropdown(dropdown_settings);
                }.bind(this),
                complete: this.hide.bind(this)
            });

        },

        bindAccount: function (account) {
            this.account = account;
            this.$el.attr('data-color', this.account.settings.get('color'));
            this.$('.account-field .dropdown-button .account-item-wrap')
                    .replaceWith(this.renderAccountItem(account));
            let all_servers = this.account.get('groupchat_servers_list');
            if (all_servers.length)
                this.$('.xmpp-server-dropdown-wrap .field-jid').text(all_servers[0]);
            else
                this.setCustomDomain(this.$('.property-field.xmpp-server-dropdown-wrap .property-value'));
            this.$('.modal-content .jid-field .set-default-domain').remove();
            for (var i = 0; i < all_servers.length; i++) {
                $('<div/>', {class: 'field-jid property-variant set-default-domain'}).text(all_servers[i]).insertBefore(this.$('.modal-content .jid-field .set-custom-domain'));
            }
        },

        renderAccountItem: function (account) {
            let $item = $(templates.add_chat_account_item({jid: account.get('jid')}));
            return $item;
        },

        selectAccount: function (ev) {
            let $item = $(ev.target).closest('.account-item-wrap'),
                account = xabber.accounts.get($item.data('jid'));
            this.bindAccount(account);
        },

        setCustomDomain: function ($property_value) {
            this.$('#new_chat_domain').val("");
            $property_value.text("");
            this.$('.input-group-chat-domain').removeClass('hidden');
        },

        changePropertyValue: function (ev) {
            let $property_item = $(ev.target),
                $property_value = $property_item.closest('.property-field').find('.property-value');
            if ($property_item.hasClass('set-custom-domain')) {
                this.setCustomDomain($property_value);
                return;
            }
            else if ($property_item.hasClass('set-default-domain')) {
                this.$('.input-group-chat-domain').addClass('hidden');
                this.$('#new_chat_domain').val("");
            }
            $property_value.text($property_item.text());
            $property_value.attr('data-value', $property_item.attr('data-value'));
        },

        close: function () {
            this.$el.closeModal({ complete: this.hide.bind(this) });
        },

        updateGroupJid: function () {
            let elem = this.$('input[name=chat_jid]');
            if (!elem.hasClass('fixed-jid')) {
                let text = slug(this.$('.input-group-chat-name input').get(0).value, {lower: true});
                this.$("label[for=new_chat_jid]").addClass('active');
                this.$('.input-field #new_chat_jid').get(0).value = text;
            }
            if (this.$('.input-group-chat-name input').get(0).value)
                this.$('.btn-add').removeClass('non-active');
            else
                this.$('.btn-add').addClass('non-active');
        },

        showPlaceholder: function (ev) {
            let textarea_is_empty = (this.$('.rich-textarea ').text() !== "") ? false : true;
            this.$('.rich-textarea-wrap .placeholder').hideIf(!textarea_is_empty);
        },

        fixJid: function () {
            let elem = this.$('input[name=chat_jid]');
            if (!elem.hasClass('fixed-jid')) {
                elem.addClass('fixed-jid');
            }
            if (elem.get(0).value == "") {
                elem.removeClass('fixed-jid');
            }
        },

        createGroupChat: function () {
            var my_jid = this.account.resources.connection.jid,
                name = this.$('input[name=chat_name]').val(),
                chat_jid = this.$('input[name=chat_jid]').val() ? this.$('input[name=chat_jid]').val() : undefined,
                anonymous = this.$('.incognito-field .property-value').attr('data-value'),
                domain = this.$('#new_chat_domain').val() || this.$('.xmpp-server-dropdown-wrap .property-value').text(),
                searchable = this.$('.global-field .property-value').attr('data-value'),
                description = this.$('.description-field .rich-textarea').text() || 'The best group chat',
                model = this.$('.membership-field .property-value').attr('data-value'),
                iq = $iq({from: my_jid, type: 'set', to: domain}).c('create', {xmlns: Strophe.NS.GROUP_CHAT})
                    .c('name').t(name).up()
                    .c('privacy').t(anonymous).up()
                    .c('index').t(searchable).up()
                    .c('description').t(description).up()
                    .c('membership').t(model).up();
                if (chat_jid)
                    iq.c('localpart').t(chat_jid);
            this.account.sendIQ(iq,
                function (iq) {
                    if ($(iq).attr('type') === 'result'){
                        var group_jid = $(iq).find('created jid').text();
                        var contact = this.account.contacts.mergeContact(group_jid);
                        contact.set('group_chat', true);
                        contact.pres('subscribed');
                        contact.pushInRoster(null, function () {
                            contact.pres('subscribe');
                            contact.getMyInfo();
                            this.close();
                            xabber.chats_view.updateScreenAllChats();
                            contact.subGroupPres();
                            contact.trigger("open_chat", contact);
                        }.bind(this));
                    }
                }.bind(this),
                function () {
                    this.$('.modal-footer .errors').removeClass('hidden').text('Jid is already in use');
                }.bind(this));
        },

        addGroupChat: function (ev) {
            if ($(ev.target).hasClass('non-active')) {
                $(ev.target).blur();
                return;
            }
            var xmpp_server = this.$('#new_chat_domain').val() || this.$('.xmpp-server-dropdown-wrap .property-value').text(),
                input_value = this.$('input[name=chat_jid]').val();
            if (this.$('input[name=chat_name]').val() == "")
                this.$('.modal-footer .errors').text('Enter group chat name').removeClass('hidden');
            else {
            if ((input_value == "")||((input_value.search(/[А-яЁё]/) == -1)&&(input_value.search(/\s/) == -1)&&(input_value != ""))) {
            this.$('.modal-footer .errors').text('').addClass('hidden');
            var jid = this.account.resources.connection.jid,
                iq = $iq({from: jid, type: 'get', to: xmpp_server}).c('query', {xmlns: Strophe.NS.DISCO_INFO}),
                group_chats_support;
            this.account.sendIQ(iq, function (iq) {
                $(iq).children('query').children('feature').each(function(elem, item) {
                    if ($(item).attr('var') == Strophe.NS.GROUP_CHAT)
                        group_chats_support = true;
                }.bind(this));
                if (group_chats_support)
                    this.createGroupChat();
            }.bind(this),
                function (error) {
                    this.$('.modal-footer .errors').removeClass('hidden').text('Invalid domain');
                }.bind(this));
            }
            else {
                this.$('.modal-footer .errors').removeClass('hidden').text('Invalid jid');
            }
        }
        }
    });

    xabber.ChatsView = xabber.SearchView.extend({
        className: 'recent-chats-container container',
        ps_selector: '.chat-list-wrap',
        ps_settings: {theme: 'item-list'},
        template: templates.chats_panel,

        _initialize: function () {
            this.active_chat = null;
            this.model.on("add", this.onChatAdded, this);
            this.model.on("destroy", this.onChatRemoved, this);
            this.model.on("change:active", this.onChangedActiveStatus, this);
            this.model.on("change:timestamp", this.updateChatPosition, this);
            xabber.accounts.on("list_changed", this.updateLeftIndicator, this);
        },

        render: function (options) {
            options.right !== 'chat' && this.clearSearch();
            if (xabber.toolbar_view.$('.active').hasClass('all-chats')) {
                this.showAllChats();
            }
        },

        updateLeftIndicator: function (accounts) {
            this.$el.attr('data-indicator', accounts.connected.length > 1);
        },

        onChatAdded: function (chat) {
            this.addChild(chat.id, chat.item_view);
            this.updateChatPosition(chat);
        },

        onChatRemoved: function (chat, options) {
            if (this.active_chat === this.child(chat.id)) {
                this.active_chat = null;
                xabber.body.setScreen(null, {chat_item: null},
                        {silent: !xabber.body.isScreen('all-chats')});
            }
            this.removeChild(chat.id, options);
            this.updateScrollBar();
        },

        onChangedActiveStatus: function (chat) {
            if (chat.get('active')) {
                var previous_chat = this.active_chat;
                this.active_chat = this.child(chat.id);
                previous_chat && previous_chat.model.set('active', false);
            }
        },

        replaceChatItem: function (item, chats) {
            let view = this.child(item.id);
            if (view && item.get('timestamp')) {
                view.$el.detach();
                let index = chats.indexOf(item);
                if (index === 0) {
                    this.$('.chat-list').prepend(view.$el);
                } else {
                    this.$('.chat-item').eq(index - 1).after(view.$el);
                }
            }
        },

        updateChatPosition: function (item) {
            let view = this.child(item.id),
                active_toolbar = xabber.toolbar_view.$('.active');
            if (!view)
                return;
            active_toolbar.hasClass('group-chats') && view.contact.get('group_chat') && this.replaceChatItem(item, this.model.filter(chat => chat.contact.get('group_chat') && !chat.contact.get('archived')));
            active_toolbar.hasClass('chats') && !view.contact.get('group_chat') && this.replaceChatItem(item, this.model.filter(chat => !chat.contact.get('group_chat') && !chat.contact.get('archived')));
            active_toolbar.hasClass('all-chats') && !view.contact.get('archived') && this.replaceChatItem(item, this.model.filter(chat => !chat.contact.get('archived')));
            active_toolbar.hasClass('archive-chats') && view.contact.get('archived') && this.replaceChatItem(item, this.model.filter(chat => chat.contact.get('archived')));
        },

        search: function (query) {
            var chats = this.model;
            this.$('.chat-item').each(function () {
                var $this = $(this),
                    chat = chats.get($this.data('id'));
                if (!chat) return;
                var jid = chat.get('jid'),
                    name = chat.contact.get('name').toLowerCase();
                $this.hideIf(name.indexOf(query) < 0 && jid.indexOf(query) < 0);
            });
        },

        onEnterPressed: function (selection) {
            var view = this.child(selection.data('id'));
            view && view.open();
        },

        openChat: function (view, options) {
            options.clear_search && this.clearSearch();
            if ((!view.contact.get('in_roster'))&&(view.model.get('is_accepted') == false)) {
                view.model.set('display', true);
                view.model.set('active', true);
                xabber.body.setScreen('all-chats', {right: 'group_invitation', contact: view.contact });
                view.content.readMessages();
            }
            else
            {
                if (xabber.toolbar_view.$('.active').hasClass('contacts'))
                    this.updateScreenAllChats();
                if (!view.model.get('displayed_sent') && view.model.messages.length) {
                    let last_msg = view.model.messages.models[view.model.messages.length - 1];
                    if (last_msg)
                        if (!last_msg.isSenderMe() && !last_msg.get('is_unread')) {
                            view.model.sendMarker(last_msg.get('msgid'), 'displayed');
                            view.model.set('displayed_sent', true);
                        }
                }
                xabber.body.setScreen('all-chats', {right: 'chat', chat_item: view});
            }
        },

        removeInvite: function (view, options) {
            var invites = view.content.$('.auth-request');
            if (invites.length > 0) {
                invites.each(function (idx, item) {
                    view.model.messages.get($(item).attr('msgid')).destroy();
                    view.content.removeMessage($(item));
                }.bind(this));
            }
        },

        showGroupChats: function () {
            this.$('.chat-item').detach();
            let chats = this.model,
                group_chats = chats.filter(chat => chat.contact.get('group_chat') && chat.get('timestamp') && !chat.contact.get('archived'));
            group_chats.forEach(function (chat) {
                this.$('.chat-list').append(chat.item_view.$el);
                chat.item_view.updateCSS();
            });
        },

        showChats: function () {
            this.$('.chat-item').detach();
            let chats = this.model,
                private_chats = chats.filter(chat => !chat.contact.get('group_chat') && chat.get('timestamp') && !chat.contact.get('archived'));
            private_chats.forEach(function (chat) {
                this.$('.chat-list').append(chat.item_view.$el);
                chat.item_view.updateCSS();
            });
        },

        showChatsByAccount: function (account) {
            xabber.body.setScreen('all-chats', {right: null});
            this.$('.chat-item').detach();
            let chats = this.model,
                account_chats = chats.filter(chat => (chat.account.get('jid') === account.get('jid')) && chat.get('timestamp') && !chat.contact.get('archived'));
            account_chats.forEach(function (chat) {
                this.$('.chat-list').append(chat.item_view.$el);
                chat.item_view.updateCSS();
            });
        },

        showArchiveChats: function () {
            this.$('.chat-item').detach();
            let chats = this.model,
                archive_chats = chats.filter(chat => chat.contact.get('archived'));
            archive_chats.forEach(function (chat) {
                this.$('.chat-list').append(chat.item_view.$el);
                chat.item_view.updateCSS();
            });
        },

        showAllChats: function () {
            this.$('.chat-item').detach();
            let chats = this.model,
                all_chats = chats.filter(chat => chat.get('timestamp') && !chat.contact.get('archived'));
            all_chats.forEach(function (chat) {
                this.$('.chat-list').append(chat.item_view.$el);
                chat.item_view.updateCSS();
            });
        },

        updateScreenAllChats: function () {
            xabber.toolbar_view.$('.toolbar-item').removeClass('active')
                .filter('.all-chats').addClass('active');
            this.showAllChats();
        }
    });

    xabber.ForwardPanelView = xabber.SearchView.extend({
        className: 'modal forward-panel-modal',
        template: templates.forward_panel,
        ps_selector: '.chat-list-wrap',
        ps_settings: {theme: 'item-list'},

        events: {
            "keyup .search-input": "keyUpOnSearch",
            "focusout .search-input": "clearSearchSelection",
            "click .close-search-icon": "clearSearch",
            'click .list-item': 'clickOnItem',
            'click .close-button': 'close'
        },

        open: function (messages, account) {
            this.messages = messages;
            this.account = account;
            this.$('.chat-list').html('');
            this.$('.chat-list').html(xabber.chats_view.$('.chat-list').html()).find('.chat-item').removeClass('hidden');
            this.$('.chat-list').prepend($('<div/>', { class: 'forward-panel-list-title'}).text('Recent chats'));
            this.$('.chat-list').append($('<div/>', { class: 'forward-panel-list-title'}).text('Contacts'));
            xabber.contacts_view.$('.account-roster-wrap[data-jid="'+this.account.get('jid')+'"] .roster-contact.list-item').each(function (idx, item) {
                var chat_id = this.account.contacts.get($(item).data('jid')).hash_id;
                if (this.$('.chat-list .chat-item[data-id="' + chat_id + '"]').length == 0) {
                    var contact_list_item = $(item).clone();
                    contact_list_item.find('.blocked-indicator').hide();
                    contact_list_item.find('.muted-icon').hide();
                    this.$('.chat-list').append(contact_list_item);
                }
            }.bind(this));

            this.$('.chat-item').removeClass('active');
            this.clearSearch();
            this.data.set('visible', true);
            this.$el.openModal({
                ready: function () {
                    this.updateScrollBar();
                    this.$('.search-input').focus();
                }.bind(this),
                complete: function () {
                    this.$el.detach();
                    this.data.set('visible', false);
                }.bind(this)
            });
        },

        close: function () {
            var deferred = new $.Deferred();
            this.$el.closeModal({ complete: function () {
                this.$el.detach();
                this.data.set('visible', false);
                deferred.resolve();
            }.bind(this)});
            return deferred.promise();
        },

        clickOnItem: function (ev) {
            var $target = $(ev.target).closest('.list-item'), chat_item;
            if ($target.hasClass('roster-contact'))
                chat_item = xabber.chats_view.child(this.account.contacts.get($target.data('jid')).hash_id);
            if ($target.hasClass('chat-item'))
                chat_item = xabber.chats_view.child($target.data('id'));
            chat_item && this.forwardTo(chat_item);
        },

        search: function (query) {
            query = query.toLowerCase();
            this.$('.roster-contact').each(function (idx, item) {
                var jid = $(item).attr('data-jid'),
                    name = this.account.contacts.get(jid).get('name').toLowerCase();
                $(item).hideIf(name.indexOf(query) < 0 && jid.indexOf(query) < 0);
            }.bind(this));
            this.$('.chat-item').each(function (idx, item) {
                var chat = xabber.chats.get($(item).data('id')),
                    jid = chat.get('jid'),
                    name =chat.contact.get('name').toLowerCase();
                $(item).hideIf(name.indexOf(query) < 0 && jid.indexOf(query) < 0);
            }.bind(this));
        },

        keyUpOnSearch: function () {
            this.$('.modal-footer .errors').addClass('hidden');
            this.search(this.$('.search-input').val());
        },

        onEnterPressed: function (selection) {
            var chat_item = xabber.chats_view.child(selection.data('id'));
            chat_item && this.forwardTo(chat_item);
        },

        forwardTo: function (chat_item) {
            chat_item.content.bottom.setForwardedMessages(this.messages);
            this.messages = [];
            this.close().done(function () {
                chat_item.open({clear_search: true});
            });
        }
    });

    xabber.InvitationPanelView = xabber.SearchView.extend({
        className: 'modal forward-panel-modal add-user-group-chat',
        template: templates.group_chats.invitation_panel_view,
        ps_selector: '.item-list',

        events: {
            "click .close-button": "close",
            "keyup .search-input": "keyUpOnSearch",
            "click .btn-add": "addSelectedUsers",
            "click .list-item": "addUser",
            "click .arrow": "toggleContacts",
            "click .group-head": "selectAllGroup"
        },

        open: function (account, contact) {
            this.selected_contacts = [];
            this.$('.modal-footer .errors').text('');
            this.$('.counter').text('');
            this.account = account;
            this.contact = contact;
            this.$('.chat-list').empty();
            xabber.contacts_view.$('.account-roster-wrap[data-jid="'+this.account.get('jid')+'"] .roster-group').each(function (idx, item) {
                var group_node = $(item).clone();
                $(group_node).find('.list-item').each(function (i, list_item) {
                    var contact_node = this.account.contacts.get($(list_item).attr('data-jid'));
                        if (contact_node.get('group_chat'))
                            list_item.remove();
                }.bind(this));
                this.$('.chat-list').append(group_node);
                var contacts_counter = group_node.find('.list-item').length;
                group_node.find('.member-counter.one-line').text('(' + contacts_counter + ')');
            }.bind(this));
            this.$('.roster-group').each(function (idx, item) {
                var $item = $(item);
                if ($item.find('.roster-contact').length == 0)
                    $item.remove();
            }.bind(this));
            this.$('.chat-item').removeClass('active');
            this.clearSearch();
            this.data.set('visible', true);
            this.$el.openModal({
                ready: function () {
                    this.updateScrollBar();
                    this.$('.search-input').focus();
                }.bind(this),
                complete: function () {
                    this.$el.detach();
                    this.data.set('visible', false);
                }.bind(this)
            });
        },

        addSelectedUsers: function() {
            if (this.selected_contacts.length == 0) {
                return;
            }
            $(this.selected_contacts).each(function (idx, item) {
                this.sendInvite(item);
            }.bind(this));
        },

        addUser: function (ev) {
            var $target = $(ev.target).closest('.list-item'),
                contact_jid = $target.attr('data-jid');

            if ($target.hasClass('selected')) {
                $target.removeClass('selected');
                var itemIdx = this.selected_contacts.indexOf(contact_jid);
                if (itemIdx > -1) {
                    this.selected_contacts.splice(itemIdx, 1);
                }
            }
            else {
                $target.addClass('selected');
                this.selected_contacts.push(contact_jid);
            }
            this.updateCounter();
        },

        sendInvite: function (contact_jid) {
            var iq = $iq({from: this.account.get('jid'), type: 'set', to: this.contact.get('jid')})
                .c('invite', {xmlns: Strophe.NS.GROUP_CHAT + '#invite'})
                .c('jid').t(contact_jid).up();
            if (this.contact.get('group_info').model == 'member-only')
                iq.c('send').t(true).up();
            iq.c('reason').t('Invitation to a group chat');
            this.account.sendIQ(iq,
                function () {
                    if (this.contact.get('group_info').model == 'open')
                        this.sendInviteMessage(contact_jid);
                    this.close();
                }.bind(this),

                function(iq) {
                    this.onInviteError(iq);
                }.bind(this));
        },

        onInviteError: function (iq) {
            var err_text;
            if ($(iq).find('not-allowed').length > 0) {
                err_text = $(iq).find('text').text() || 'You have no permission';
            }
            if ($(iq).find('conflict').length > 0) {
                err_text = $(iq).find('text').text() || $(iq).find('invite').find('jid').text() + ' already invited in group chat';
            }
            this.$('.modal-footer .errors').removeClass('hidden').text(err_text);
        },

        sendInviteMessage: function(jid_to) {
            var body = 'Add '+ this.contact.get('jid') +' to the contacts to join a group chat',
                stanza = $msg({
                    from: this.account.get('jid'),
                    to: jid_to,
                    type: 'chat'
                }).c('invite', {xmlns: Strophe.NS.GROUP_CHAT, jid: this.contact.get('jid')})
                    .c('reason').t('Invitation to a group chat').up().up()
                    .c('body').t(body).up();

            this.account.sendMsg(stanza);
        },

        search: function (query) {
            query = query.toLowerCase();
            this.$('.list-item').each(function (idx, item) {
                var jid = $(item).attr('data-jid'),
                    name = this.account.contacts.get(jid).get('name').toLowerCase();
                $(item).hideIf(name.indexOf(query) < 0 && jid.indexOf(query) < 0); // || this.$('.list-item[data-jid="' + jid + '"]').length > 1
            }.bind(this));
            if (query == "")
                this.$('.group-head').removeClass('hidden');
            else
                this.$('.group-head').addClass('hidden');
            this.scrollToTop();
        },

        keyUpOnSearch: function () {
            this.$('.modal-footer .errors').addClass('hidden');
            this.search(this.$('.search-input').val());
        },

        close: function () {
            this.$el.closeModal({ complete: this.hide.bind(this) });
        },


        toggleContacts: function(ev) {
            var is_visible = $(ev.target).hasClass('mdi-chevron-down');
            if (is_visible) {
                var group_roster = $(ev.target).closest('.roster-group');
                group_roster.find('.list-item').each(function (idx, item) {
                    $(item).addClass('hidden');
                }.bind(this));
            }
            else
            {
                var group_roster = $(ev.target).closest('.roster-group');
                group_roster.find('.list-item').each(function (idx, item) {
                    $(item).removeClass('hidden');
                }.bind(this));
            }
            $(ev.target).switchClass('mdi-chevron-right', is_visible);
            $(ev.target).switchClass('mdi-chevron-down', !is_visible);
        },

        selectAllGroup: function (ev) {
            if ($(ev.target).hasClass('arrow'))
                return;
           var group_roster = $(ev.target).closest('.roster-group');
           if (group_roster.hasClass('.selected')) {
               group_roster.removeClass('.selected');
               group_roster.find('.list-item').each(function (idx, item) {
                   var contact_jid = $(item).attr('data-jid'),
                       itemIdx = this.selected_contacts.indexOf(contact_jid);
                   if (itemIdx > -1) {
                       this.selected_contacts.splice(itemIdx, 1);
                       $(item).removeClass('selected');
                   }
               }.bind(this));
           }
           else
           {
               group_roster.addClass('.selected');
               group_roster.find('.list-item').each(function (idx, item) {
                   var contact_jid = $(item).attr('data-jid'),
                       itemIdx = this.selected_contacts.indexOf(contact_jid);
                   if (itemIdx > -1)
                       return;
                   else
                       this.selected_contacts.push(contact_jid);
                   $(item).addClass('selected');
               }.bind(this));
           }
            this.updateCounter();
        },

        updateCounter: function () {
            var selected_counter = this.$('.list-item.selected').length;
            (selected_counter) ? this.$('.counter').removeClass('hidden').text(selected_counter) : this.$('.counter').text('');
        }

    });

    xabber.ChatHeadView = xabber.BasicView.extend({
        className: 'chat-head-wrap',
        template: templates.chat_head,
        avatar_size: constants.AVATAR_SIZES.CHAT_HEAD,

        events: {
            "click .contact-name": "showContactDetails",
            "click .circle-avatar": "showContactDetails",
            "click .btn-notifications": "changeNotifications",
            "click .btn-contact-details": "showContactDetails",
            "click .btn-clear-history": "clearHistory",
            "click .btn-block-contact": "blockContact",
            "click .btn-unblock-contact": "unblockContact",
            "click .btn-close-chat": "closeChat",
            "click .btn-archive-chat": "archiveChat",
            "click .btn-search-messages": "renderSearchPanel"
        },

        _initialize: function (options) {
            this.content = options.content;
            this.contact = this.content.contact;
            this.model = this.content.model;
            this.account = this.model.account;
            this.updateName();
            this.updateStatus();
            this.updateAvatar();
            this.updateMenu();
            this.updateNotifications();
            this.updateArchiveButton();
            this.contact.on("change:name", this.updateName, this);
            this.contact.on("change:status_updated", this.updateStatus, this);
            this.contact.on("change:status_message", this.updateStatusMsg, this);
            this.contact.on("change:image", this.updateAvatar, this);
            this.contact.on("change:blocked", this.updateMenu, this);
            this.contact.on("change:muted", this.updateNotifications, this);
            this.contact.on("change:group_chat", this.updateGroupChatHead, this);
        },

        render: function (options) {
            this.$('.tooltipped').tooltip('remove');
            this.$('.tooltipped').tooltip({delay: 50});
            this.$('.btn-more').dropdown({
                inDuration: 100,
                outDuration: 100,
                hover: false
            });
            this.$('.chat-head-menu').hide();
            this.updateGroupChatHead();
            return this;
        },

        updateName: function () {
            this.$('.contact-name').text(this.contact.get('name'));
        },

        updateStatus: function () {
            var status = this.contact.get('status'),
                status_message = this.contact.getStatusMessage();
            this.$('.contact-status').attr('data-status', status);
            this.$('.contact-status-message').text(status_message);
        },

        updateStatusMsg: function () {
            var group_text = 'Group chat';
            if (this.contact.get('group_info')) {
                group_text = this.contact.get('group_info').members_num;
                if (this.contact.get('group_info').members_num > 1)
                    group_text += ' participants';
                else
                    group_text += ' participant';
                if (this.contact.get('group_info').online_members_num > 0)
                    group_text += ', ' + this.contact.get('group_info').online_members_num + ' online';
            }
            this.contact.get('group_chat') ? this.$('.contact-status-message').text(group_text) : this.$('.contact-status-message').text(this.contact.getStatusMessage());
            this.$('.contact-status-message').text(this.contact.getStatusMessage());
        },

        updateAvatar: function () {
            var image = this.contact.cached_image;
            this.$('.circle-avatar').setAvatar(image, this.avatar_size);
        },

        updateMenu: function () {
            var is_blocked = this.contact.get('blocked');
            this.$('.btn-block-contact').hideIf(is_blocked);
            this.$('.btn-unblock-contact').showIf(is_blocked);
        },

        renderSearchPanel: function () {
            let visible_view;
            if (this.content.isVisible())
                visible_view = this.content;
            this.contact.messages_view && this.contact.messages_view.isVisible() && (visible_view = this.contact.messages_view);
            visible_view.$search_form.slideToggle(200, function () {
                if (visible_view.$search_form.css('display') === 'none')
                    visible_view.$el.css('padding-top', '0');
                else {
                    visible_view.$el.css('padding-top', '36px');
                    visible_view.$search_form.find('input').focus();
                }
            }.bind(this));
        },

        showContactDetails: function () {
            this.contact.showDetails('all-chats');
        },

        updateNotifications: function () {
            var muted = this.contact.get('muted');
            this.$('.btn-notifications .muted').showIf(muted);
            this.$('.btn-notifications .no-muted').hideIf(muted);
        },

        changeNotifications: function () {
            var muted = !this.contact.get('muted');
            this.contact.set('muted', muted);
            this.account.chat_settings.updateMutedList(this.contact.get('jid'), muted);
        },

        archiveChat: function (ev) {
            if (ev) {
                if (($(ev.target).hasClass('mdi-package-down')) || ($(ev.target).hasClass('mdi-package-up'))) {
                    var archived_chat = this.model.item_view.$el,
                        next_chat_item = archived_chat,
                        next_chat = null,
                        next_contact;
                    while ((next_chat == null) && (next_chat_item.length > 0)) {
                        next_chat_item = next_chat_item.next();
                        if (next_chat_item) {
                            if (!next_chat_item.hasClass('hidden')) {
                                var next_chat_id = next_chat_item.attr('data-id');
                                next_chat = this.account.chats.get(next_chat_id);
                            }
                        }
                    }
                    if (next_chat != null) {
                        next_contact = next_chat.contact;
                        next_contact.trigger("open_chat", next_contact);
                    }
                    else
                    {
                        this.getActiveScreen();
                    }
                }
            }
            var archived = !this.contact.get('archived'),
                is_archived = archived ? true : false;
            this.contact.set('archived', archived);
            this.$('.btn-archive-chat .mdi').switchClass('mdi-package-up', is_archived);
            this.$('.btn-archive-chat .mdi').switchClass('mdi-package-down', !is_archived);
            this.account.chat_settings.updateArchiveChatsList(this.contact.get('jid'), archived);
        },

        getActiveScreen: function () {
            var active_screen = xabber.toolbar_view.$('.active');
            if (active_screen.hasClass('archive-chats')) {
                xabber.toolbar_view.showArchive();
                return;
            }
            if (active_screen.hasClass('all-chats')) {
                xabber.toolbar_view.showAllChats();
                return;
            }
            if (active_screen.hasClass('chats')) {
                xabber.toolbar_view.showChats();
                return;
            }
            if (active_screen.hasClass('group-chats')) {
                xabber.toolbar_view.showGroupChats();
                return;
            }
        },

        updateArchiveButton: function () {
            var archived = this.contact.get('archived'),
                is_archived = archived ? true : false;
            this.contact.set('archived', archived);
            this.$('.btn-archive-chat .mdi').switchClass('mdi-package-up', is_archived);
            this.$('.btn-archive-chat .mdi').switchClass('mdi-package-down', !is_archived);
        },

        updateGroupChatHead: function () {
            var is_group_chat = this.contact.get('group_chat');
            this.$('.group-chat-icon').showIf(is_group_chat);
            this.$('.btn-search-messages').showIf(is_group_chat);
            this.$('.contact-status').hideIf(is_group_chat);
        },

        clearHistory: function () {
            this.content.clearHistory();
            xabber.chats_view.clearSearch();
        },

        blockContact: function () {
            this.contact.block();
            xabber.chats_view.clearSearch();
        },

        unblockContact: function () {
            this.contact.unblock();
            xabber.chats_view.clearSearch();
        },

        closeChat: function () {
            this.model.set('opened', false);
            xabber.chats_view.clearSearch();
        }
    });

    xabber.ChatBottomView = xabber.BasicView.extend({
        className: 'chat-bottom-wrap',
        template: templates.chat_bottom,
        avatar_size: constants.AVATAR_SIZES.CHAT_BOTTOM,

        events: {
            "click .my-avatar": "showAccountSettings",
            "keyup .input-message .rich-textarea": "keyUp",
            "keydown .input-message .rich-textarea": "keyDown",
            "change .attach-file input": "onFileInputChanged",
            "mouseup .attach-voice-message": "writeVoiceMessage",
            "mouseup .message-input-panel": "stopWritingVoiceMessage",
            "mousedown .attach-voice-message": "writeVoiceMessage",
            "click .close-forward": "unsetForwardedMessages",
            "click .send-message": "submit",
            "click .reply-message": "forwardMessages",
            "click .forward-message": "forwardMessages",
            "click .pin-message": "pinMessage",
            "click .copy-message": "copyMessages",
            "click .edit-message": "showEditPanel",
            "click .btn-save": "submit",
            "click .delete-message": "deleteMessages",
            "click .close-message-panel": "resetSelectedMessages",
        },

        _initialize: function (options) {
            this.view = options.content;
            this.model = this.view.model;
            this.contact = this.view.contact;
            this.account = this.view.account;
            this.fwd_messages = [];
            this.edit_message = null;
            this.chat_state = false;
            this.$('.account-jid').text(this.account.get('jid'));
            this.updateAvatar();
            this.account.on("change:image", this.updateAvatar, this);
            var $rich_textarea = this.$('.input-message .rich-textarea'),
                rich_textarea = $rich_textarea[0],
                $rich_textarea_wrap = $rich_textarea.parent('.rich-textarea-wrap'),
                $placeholder = $rich_textarea.siblings('.placeholder');
            rich_textarea.onpaste = this.onPaste.bind(this);
            rich_textarea.oncut = this.onCut.bind(this);
            rich_textarea.ondragenter = function (ev) {
                ev.preventDefault();
                $placeholder.text('Drop files here to send');
                $rich_textarea_wrap.addClass('file-drop');
            };
            rich_textarea.ondragover = function (ev) {
                ev.preventDefault();
            };
            rich_textarea.ondragleave = function (ev) {
                ev.preventDefault();
                $placeholder.text('Write a message...');
                $rich_textarea_wrap.removeClass('file-drop');
            };
            rich_textarea.ondrop = function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                $placeholder.text('Write a message...');
                $rich_textarea_wrap.removeClass('file-drop');
                var files = ev.dataTransfer.files || [];
                this.view.addFileMessage(files);
            }.bind(this);
            var $insert_emoticon = this.$('.insert-emoticon'),
                $emoji_panel_wrap = this.$('.emoticons-panel-wrap'),
                $emoji_panel = this.$('.emoticons-panel'),
                _timeout;

            _.each(Emoji.all, function (emoji) {
                $('<div class="emoji-wrap"/>').html(
                    emoji.emojify({tag_name: 'div', emoji_size: 25})
                ).appendTo($emoji_panel);
            });
            $emoji_panel.perfectScrollbar(
                    _.extend({theme: 'item-list'}, xabber.ps_settings));
            $insert_emoticon.hover(function (ev) {
                if (ev && ev.preventDefault) { ev.preventDefault(); }
                $emoji_panel_wrap.addClass('opened');
                if (_timeout) {
                    clearTimeout(_timeout);
                }
                $emoji_panel.perfectScrollbar('update');
            }.bind(this), function (ev) {
                if (ev && ev.preventDefault) { ev.preventDefault(); }
                if (_timeout) {
                    clearTimeout(_timeout);
                }
                _timeout = setTimeout(function () {
                    if (!$emoji_panel_wrap.is(':hover')) {
                        $emoji_panel_wrap.removeClass('opened');
                    }
                }, 800);
            }.bind(this));
            $emoji_panel_wrap.hover(null, function (ev) {
                if (ev && ev.preventDefault) { ev.preventDefault(); }
                if (_timeout) {
                    clearTimeout(_timeout);
                }
                _timeout = setTimeout(function () {
                    $emoji_panel_wrap.removeClass('opened');
                }, 200);
            }.bind(this));
            $emoji_panel_wrap.mousedown(function (ev) {
                if (ev && ev.preventDefault) { ev.preventDefault(); }
                if (ev.button) {
                    return;
                }
                var $target = $(ev.target).closest('.emoji-wrap').find('.emoji');
                $target.length && this.typeEmoticon($target.data('emoji'));
            }.bind(this));
            this.renderLastEmoticons();
        },

        render: function (options) {
            this.updateAvatar();
            var http_upload = this.account.server_features.get(Strophe.NS.HTTP_UPLOAD),
                is_group_chat = this.contact.get('group_chat');
            this.content_view = (this.view.data.get('visible') ? this.view : this.contact.messages_view);
            this.messages_arr = this.content_view.$el.hasClass('participant-messages-wrap') ? this.account.participant_messages : this.model.messages;
            this.renderLastEmoticons();
            this.$('.btn-more-actions').dropdown({
                inDuration: 100,
                outDuration: 100,
                hover: false
            });
            this.$('.attach-file').showIf(http_upload);
            this.$('button.copy-message').showIf(!is_group_chat);
            this.$('li.copy-message').showIf(is_group_chat);
            this.$('.btn-more-actions').showIf(is_group_chat);
            this.$('.delete-message').showIf(is_group_chat);

            if (this.contact.get('group_chat')) {
                this.updateInfoInBottom();
            }
            else {
                this.$('.account-nickname').hide();
                this.$('.account-badge').hide();
                this.$('.account-role').hide();
            }
            this.focusOnInput();
            xabber.chat_body.updateHeight();
            this.manageSelectedMessages();
            return this;
        },

        updateInfoInBottom: function () {
            if (this.contact.my_info) {
                var nickname = _.unescape(this.contact.my_info.get('nickname')),
                    badge = _.unescape(this.contact.my_info.get('badge')),
                    avatar = this.contact.my_info.get('b64_avatar'),
                    role = this.contact.my_info.get('role');
                if (nickname) {
                    this.$('.account-jid').hide();
                    this.$('.account-nickname').show().text(nickname);
                }
                else
                    this.$('.account-nickname').hide();
                if (badge)
                    this.$('.account-badge').show().text(badge);
                else
                    this.$('.account-badge').hide();
                if (role && role != 'Member')
                    this.$('.account-role').show().text(role);
                else
                    this.$('.account-role').hide();
                this.$('.input-toolbar').emojify('.account-badge', {emoji_size: 14});
                if (!avatar)
                    this.$('.circle-avatar').setAvatar(Images.getDefaultAvatar(nickname), this.avatar_size);
            }
            else {
                this.$('.account-jid').show();
                this.$('.account-nickname').hide();
                this.$('.account-badge').hide();
                this.$('.account-role').hide();
            }
        },

        updateAvatar: function () {
            let image = this.account.cached_image;
            if (this.contact.get('group_chat')) {
                if (this.contact.my_info)
                    if (this.contact.my_info.get('b64_avatar'))
                        image = this.contact.my_info.get('b64_avatar');
            }
            this.$('.circle-avatar').setAvatar(image, this.avatar_size);
        },

        focusOnInput: function () {
            var $rich_textarea = this.$('.input-message .rich-textarea');
            $rich_textarea.placeCaretAtEnd();
            return this;
        },

        keyDown: function (ev) {
            if (ev.keyCode === constants.KEY_ESCAPE ||
                    ev.keyCode === constants.KEY_BACKSPACE ||
                    ev.keyCode === constants.KEY_DELETE) {
                return;
            }
            if (ev.keyCode === constants.KEY_ENTER || ev.keyCode === 10) {
                var send_on_enter = xabber.settings.hotkeys === "enter";
                if (    (send_on_enter && ev.keyCode === constants.KEY_ENTER && !ev.shiftKey) ||
                        (!send_on_enter && ev.ctrlKey)  ) {
                    ev.preventDefault();
                    this.submit();
                    return;
                }
            }
            if (((this.$('.input-message .rich-textarea').getTextFromRichTextarea() == "")||(!this.chat_state)) && (!this.edit_message)) {
                this.view.sendChatState('composing');
                this.chat_state = true;
            }
        },

        displayMicrophone: function () {
            this.$('.mdi-send').addClass('hidden');
            this.$('.attach-voice-message').removeClass('hidden');
            this.$('.btn-save').addClass('hidden');
        },

        displaySend: function () {
            this.$('.mdi-send').removeClass('hidden');
            this.$('.attach-voice-message').addClass('hidden');
            this.$('.btn-save').addClass('hidden');
        },

        displaySaveButton: function () {
            this.$('.btn-save').removeClass('hidden');
            this.$('.mdi-send').addClass('hidden');
            this.$('.attach-voice-message').addClass('hidden');
        },

        keyUp: function (ev) {
            var $rich_textarea = $(ev.target);
            if ((this.$('.input-message .rich-textarea').getTextFromRichTextarea() != "") && !this.edit_message) {
                this.displaySend();
            }
            if (ev.keyCode === constants.KEY_ESCAPE) {
                // clear input
                ev.preventDefault();
                this.displayMicrophone();
                $rich_textarea.flushRichTextarea();
                this.unsetForwardedMessages();
                this.view.sendChatState('active');
            } else if ((ev.keyCode === constants.KEY_BACKSPACE || ev.keyCode === constants.KEY_DELETE) && !this.edit_message) {
                var text = $rich_textarea.getTextFromRichTextarea();
                if (!text || text == "\n") {
                    if (this.$('.fwd-messages-preview').hasClass('hidden'))
                        this.displayMicrophone();
                    else
                        this.displaySend();
                    $rich_textarea.flushRichTextarea();
                    this.view.sendChatState('active');
                }
            }
            $rich_textarea.updateRichTextarea().focus();
            xabber.chat_body.updateHeight();
        },

        onCut: function (ev) {
            if (this.$('.fwd-messages-preview').hasClass('hidden'))
                this.displayMicrophone();
            else {
                this.displaySend();
            }
        },

        onPaste: function (ev) {
            ev.preventDefault();
            var $rich_textarea = $(ev.target),
                clipboard_data = ev.clipboardData;
            if (clipboard_data) {
                if (clipboard_data.files.length > 0) {
                    var image_from_clipboard = clipboard_data.files[clipboard_data.files.length - 1],
                        blob_image = window.URL.createObjectURL(new Blob([image_from_clipboard])),
                        options = { blob_image_from_clipboard: blob_image};
                    utils.dialogs.ask("Send Image from Clipboard", "Do you want to send Image from Clipboard?", options, { ok_button_text: 'send'}).done(function (result) {
                        if (result) {
                            image_from_clipboard.name = 'clipboard.png';
                            this.view.addFileMessage([image_from_clipboard]);
                        }
                    }.bind(this));
                }
                else if (clipboard_data.items.length > 0) {
                    var image_from_clipboard = clipboard_data.items[clipboard_data.items.length - 1];
                    if (image_from_clipboard.kind === 'file') {
                        var blob = image_from_clipboard.getAsFile(),
                            reader = new FileReader(), deferred = new $.Deferred();
                        reader.onload = function(event){
                            var options = { blob_image_from_clipboard: event.target.result};
                            utils.dialogs.ask("Send Image from Clipboard", "Do you want to send Image from Clipboard?", options, { ok_button_text: 'send'}).done(function (result) {
                                if (result) {
                                    deferred.resolve();
                                }
                            }.bind(this));
                        };
                        deferred.done(function () {
                            blob.name = 'clipboard.png';
                            this.view.addFileMessage([blob]);
                        }.bind(this));
                        reader.readAsDataURL(blob);
                    }
                    else {
                        var text = _.escape(clipboard_data.getData('text'));
                        window.document.execCommand('insertHTML', false, text);
                    }
                }
                else {
                    var text = _.escape(clipboard_data.getData('text'));
                    window.document.execCommand('insertHTML', false, text);
                }
            }
            this.view.sendChatState('composing');
            $rich_textarea.updateRichTextarea().focus();
            xabber.chat_body.updateHeight();
        },


        onFileInputChanged: function (ev) {
            var target = ev.target,
                files = [];
            for (var i = 0; i < target.files.length; i++) {
                files.push(target.files[i]);
            }

            if (files) {
                this.view.addFileMessage(files);
                $(target).val('');
            }
        },

        stopWritingVoiceMessage: function (ev) {
            let $bottom_panel = this.$('.message-input-panel');
            if ($bottom_panel.find('.recording').length > 0) {
                $bottom_panel.find('.recording').removeClass('recording');
                return;
            }
        },

        writeVoiceMessage: function (ev) {
            var $elem = $(ev.target);
            if ($elem.hasClass('recording'))
                $elem.removeClass('recording');
            else {
                $elem.addClass('recording ground-color-50');
                this.initAudio();
            }
        },

        initAudio: function() {
            navigator.getUserMedia = (navigator.getUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia || navigator.webkitGetUserMedia);
            if (navigator.getUserMedia) {
                let constraints = { audio: true },
                    chunks = [],
                    onSuccess = function(stream) {
                    let mediaRecorder = new MediaRecorder(stream),
                        timer = 1, start_time, end_time,
                        mic_hover = true, $mic = this.$('.send-area .attach-voice-message');
                    mediaRecorder.start();
                    mediaRecorder.onstart = function() {
                        this.view.sendChatState('composing', 'audio');
                        this._chatstate_send_timeout = setInterval(function () {
                            this.view.sendChatState('composing', 'audio');
                        }.bind(this), constants.CHATSTATE_INTERVAL_COMPOSING_AUDIO);
                        start_time = moment.now();
                        let $bottom_panel = this.$('.message-input-panel'),
                            $timer_elem = this.$('.input-voice-message .timer'),
                            $status_msg = this.$('.input-voice-message .voice-msg-status'),
                            $voice_visualizer = this.$('.input-voice-message .voice-visualizer');
                        $timer_elem.text('0:00');
                        $status_msg.css('color', '#9E9E9E').text('Release outside this form to cancel');
                        $bottom_panel.addClass('voice-message-recording');

                        let timerId = setInterval(function() {
                                if ($mic.hasClass('recording') && (timer < constants.VOICE_MSG_TIME)) {
                                    if (timer%1 == 0)
                                        $timer_elem.text(utils.pretty_duration(timer));
                                    timer = (timer*10 + 2)/10;
                                    mic_hover = $bottom_panel.is(":hover");
                                    if (!mic_hover)
                                        $status_msg.css('color', '#D32F2F').text('Release to cancel record');
                                    else
                                        $status_msg.css('color', '#9E9E9E').text('Release outside this form to cancel');
                                }
                                else
                                {
                                    mic_hover = $bottom_panel.is(":hover");
                                    mediaRecorder.stop();
                                    $mic.removeClass('recording ground-color-50');
                                    $bottom_panel.removeClass('voice-message-recording');
                                    clearInterval(timerId);
                                }
                            }.bind(this), 200),
                            flag = false,
                            timerIdDot = setInterval(function() {
                                if ($mic.hasClass('recording')) {
                                    if (flag)
                                        $voice_visualizer.css('background-color', '#FFF');
                                    else
                                        $voice_visualizer.css('background-color', '#D32F2F');
                                    flag = !flag;
                                }
                                else
                                    clearInterval(timerIdDot);
                            }, 500);
                    }.bind(this);

                    mediaRecorder.onstop = function(e) {
                        clearInterval(this._chatstate_send_timeout);
                        this.view.sendChatState('paused');
                        end_time = moment.now();
                        if (mic_hover && ((end_time - start_time)/1000 >= 1.5)) {
                            let audio_name = "Voice message", audio_type = 'audio/ogg; codecs=opus',
                                blob = new Blob(chunks, { 'type' : audio_type}),
                                file = new File([blob], audio_name, {
                                    type: audio_type,
                                });
                            file.duration = Math.round((end_time - start_time)/1000);
                            file.voice = true;
                            this.view.addFileMessage([file]);
                        }
                        chunks = [];
                    }.bind(this);

                    mediaRecorder.ondataavailable = function(e) {
                        chunks.push(e.data);
                        stream.getTracks().forEach( track => track.stop() );
                    };
                }.bind(this);

                let onError = function (error) {
                    console.log('The following error occured: ' + error);
                };

                window.navigator.getUserMedia(constraints, onSuccess, onError);
            }
        },

        typeEmoticon: function (emoji) {
            var emoji_node = emoji.emojify({tag_name: 'img'}),
                $rich_textarea = this.$('.input-message .rich-textarea');
            $rich_textarea.focus();
            window.document.execCommand('insertHTML', false, emoji_node);
            if (!this.edit_message)
                this.displaySend();
            this.view.sendChatState('composing');
            $rich_textarea.updateRichTextarea().focus();
            xabber.chat_body.updateHeight();
        },

        renderLastEmoticons: function () {
            var cached_last_emoji = this.account.chat_settings.getLastEmoji(),
                $last_emoticons = this.$('.last-emoticons').empty(),
                emoji_data, emoji;
            if (cached_last_emoji.length < 7) {
                for (var idx = 0; idx < 7; idx++) {
                    emoji = Emoji.getByIndex(idx);
                    this.account.chat_settings.updateLastEmoji(emoji);
                }
            }
            cached_last_emoji = this.account.chat_settings.getLastEmoji();
            for (var idx = 0; idx < 7; idx++) {
                $('<div class="emoji-wrap"/>').html(
                    cached_last_emoji[idx].emojify({tag_name: 'div', emoji_size: 20})
                ).appendTo($last_emoticons);
            }
            $last_emoticons.find('.emoji-wrap').mousedown(function (ev) {
                if (ev && ev.preventDefault) { ev.preventDefault(); }
                if (ev.button) {
                    return;
                }
                var $target = $(ev.target).closest('.emoji-wrap').find('.emoji');
                this.typeEmoticon($target.data('emoji'));
            }.bind(this));
        },

        submit: function () {
            var $rich_textarea = this.$('.input-message .rich-textarea'),
                text = _.escape($rich_textarea.getTextFromRichTextarea().trim());
            $rich_textarea.find('.emoji').each(function (idx, emoji_item) {
                var emoji = $(emoji_item).data('emoji');
                this.account.chat_settings.updateLastEmoji(emoji);
            }.bind(this));
            $rich_textarea.flushRichTextarea().focus();
            this.displayMicrophone();
            if (this.edit_message) {
                this.editMessage(text);
                return;
            }
            if (text || this.fwd_messages.length) {
                this.view.onSubmit(text, this.fwd_messages);
            }
            this.unsetForwardedMessages();
            this.view.sendChatState('active');
            xabber.chats_view.clearSearch();
            if (this.contact.messages_view)
                if (this.contact.messages_view.data.get('visible'))
                    this.contact.messages_view.openChat();
        },

        setEditionMessage: function (message) {
            this.$('.fwd-messages-preview').showIf(this.edit_message);
            this.$('.fwd-messages-preview .msg-author').text('Edit message');
            this.$('.fwd-messages-preview .msg-text').html(message);
            this.$('.fwd-messages-preview').emojify('.msg-text', {emoji_size: 18});
            this.displaySaveButton();
            xabber.chat_body.updateHeight();
            var emoji_node = message.emojify({tag_name: 'img'}),
                $textarea = this.$('.input-message .rich-textarea');
            $textarea.flushRichTextarea();
            window.document.execCommand('insertHTML', false, emoji_node);
            $textarea.updateRichTextarea();
            this.focusOnInput();
        },

        setForwardedMessages: function (messages) {
            this.fwd_messages = messages || [];
            this.$('.fwd-messages-preview').showIf(messages.length);
            if (messages.length) {
                var msg = messages[0],
                    msg_author, msg_text, image_preview, $img_html_preview;
                if (messages.length > 1) {
                    msg_text = messages.length + ' messages';
                } else {
                    if (msg.get('forwarded_message')) {
                        msg_text = 'Forwarded message';
                    }
                    else {
                        msg_text = msg.get('message').emojify();
                        var fwd_images = msg.get('images'), fwd_files = msg.get('files');
                        if ((fwd_images) && (fwd_files)) {
                            msg_text = msg.get('images').length + msg.get('files').length + ' files';
                        }
                        else {
                            if (fwd_images) {
                                if (fwd_images.length > 1) {
                                    msg_text = fwd_images.length + ' images';
                                }
                                else {
                                    image_preview = _.clone(msg.get('images')[0]);
                                    $img_html_preview = this.createPreviewImage(image_preview);
                                }
                            }
                            if (fwd_files) {
                                if (msg.get('files').length > 1) {
                                    msg_text = msg.get('files').length + ' files';
                                }
                                else {
                                    var filesize = msg.get('files')[0].size;
                                    msg_text = (filesize) ? msg.get('files')[0].name + ",   " + filesize : msg.get('files')[0].name;
                                }
                            }
                        }
                    }
                }
                var from_jid = msg.get('from_jid');
                if (msg.isSenderMe()) {
                    msg_author = this.account.get('name');
                } else {
                    msg_author = msg.get('from_nickname') || (this.account.contacts.get(from_jid) ? this.account.contacts.get(from_jid).get('name') : from_jid);
                }
                this.$('.fwd-messages-preview .msg-author').text(msg_author);
                if (_.isUndefined(image_preview)) {
                    this.$('.fwd-messages-preview .msg-text').html(msg_text);
                }
                else {
                    this.$('.fwd-messages-preview .msg-text').html($img_html_preview);
                }
            }
            xabber.chat_body.updateHeight();
            this.displaySend();
        },

        createPreviewImage: function(image) {
            var imgContent = new Image();
                imgContent.src = image.url;
            $(imgContent).addClass('fwd-img-preview');
            return imgContent;
        },

        unsetForwardedMessages: function (ev) {
            ev && ev.preventDefault && ev.preventDefault();
            $rich_textarea = this.$('.input-message .rich-textarea');
            this.fwd_messages = [];
            if (this.edit_message) {
                $rich_textarea.flushRichTextarea();
            }
            this.edit_message = null;
            this.$('.fwd-messages-preview').addClass('hidden');
            if ($rich_textarea.getTextFromRichTextarea() == "")
                this.displayMicrophone();
            else
                this.displaySend();
            xabber.chat_body.updateHeight();
            this.focusOnInput();
        },

        resetSelectedMessages: function () {
            this.content_view.$('.chat-message.selected').removeClass('selected');
            this.manageSelectedMessages();
        },

        manageSelectedMessages: function () {
            var $selected_msgs =  this.content_view.$('.chat-message.selected'),
                $input_panel = this.$('.message-input-panel'),
                $message_actions = this.$('.message-actions-panel');
                length = $selected_msgs.length;
            $input_panel.hideIf(length);
            $message_actions.showIf(length);
            if (length) {
                var my_msg = false;
                if (length === 1) {
                    if ($selected_msgs.first().data('from') === this.account.get('jid'))
                        my_msg = true;
                    if (this.contact.my_info)
                        if ($selected_msgs.first().data('from') === this.contact.my_info.get('id'))
                            my_msg = true;
                }
                $message_actions.find('.delete-message').showIf(this.contact.get('group_chat'));
                $message_actions.find('.pin-message').showIf((length === 1) && (this.contact.get('group_chat')));
                $message_actions.find('.edit-message').showIf((length === 1) && my_msg && (this.contact.get('group_chat')));
                $message_actions.find('.counter').text(length);
            } else {
                this.focusOnInput();
            }
        },

        pinMessage: function () {
            var $msg = this.content_view.$('.chat-message.selected').first(),
                pinned_msg = this.messages_arr.get($msg.data('msgid')),
                msg_text = pinned_msg.get('archive_id');
            this.resetSelectedMessages();
            var iq = $iq({from: this.account.get('jid'), type: 'set', to: this.contact.get('jid')})
                .c('update', {xmlns: Strophe.NS.GROUP_CHAT})
                .c('pinned-message').t(msg_text);
            this.account.sendIQ(iq, function () {},
                function (error) {
                    if ($(error).find('not-allowed').length)
                        utils.dialogs.error('You have no permission to pin/unpin message');
                });
        },

        copyMessages: function (ev) {
            var $msgs = this.content_view.$('.chat-message.selected'),
                msgs = [];
            $msgs.each(function (idx, item) {
                var msg = this.messages_arr.get(item.dataset.msgid);
                msg && msgs.push(msg);
            }.bind(this));
            this.resetSelectedMessages();
            this.pushMessagesToClipboard(msgs);
        },

        editMessage: function (text) {
            text = _.unescape(text);
            let iq = $iq({from: this.account.get('jid'), type: 'set', to: this.contact.get('jid')})
                .c('replace', {xmlns: Strophe.NS.GROUP_CHAT + '#history', id: this.edit_message})
                .c('message')
                .c('body').t(text);
            this.unsetForwardedMessages();
            this.account.sendIQ(iq, function () {}, function () {});
        },

        showEditPanel: function (ev) {
            var $msg = this.content_view.$('.chat-message.selected').first(),
                edit_msg = this.messages_arr.get($msg.data('msgid')),
                edit_msg_id = edit_msg.get('archive_id');
            this.edit_message = edit_msg_id;
            this.resetSelectedMessages();
            this.setEditionMessage(edit_msg.get('message') || "");
        },

        deleteMessages: function (ev) {
            var $msgs = this.content_view.$('.chat-message.selected'),
                msgs = [];
            $msgs.each(function (idx, item) {
                var msg = this.messages_arr.get(item.dataset.msgid);
                msg && msgs.push(msg);
            }.bind(this));
            this.resetSelectedMessages();
            this.model.retractMessages(msgs);
        },

        pushMessagesToClipboard: function (messages) {
            var fwd_msg_indicator = "",
                copied_messages = this.createTextMessage(messages, fwd_msg_indicator);
            utils.copyTextToClipboard(_.unescape(copied_messages));
        },

        createTextMessage: function (messages, fwd_msg_indicator) {
            let text_message = "";
            for (var i = 0; i < messages.length; i++) {
                var $msg = messages[i];
                let current_date = moment($msg.get('timestamp')).startOf('day'),
                    prev_date = (i) ? moment(messages[i - 1].get('timestamp')).startOf('day') : moment(0);
                if (prev_date.format('x') != current_date.format('x')) {
                    text_message += fwd_msg_indicator + utils.pretty_date(current_date) + '\n';
                }
                let msg_sender = $msg.isSenderMe() ? this.account.get('name') : ($msg.get('from_nickname') || (this.account.contacts.get($msg.get('from_jid')) ? this.account.contacts.get($msg.get('from_jid')).get('name') : $msg.get('from_jid')));
                text_message += fwd_msg_indicator + "[" + utils.pretty_time($msg.get('timestamp')) + "] " + msg_sender + ":\n";
                if ($msg.get('forwarded_message')) {
                    text_message += this.createTextMessage($msg.get('forwarded_message'), (fwd_msg_indicator + '>'));
                }
                if ($msg.get('message'))
                    text_message += fwd_msg_indicator + $msg.get('message') + '\n';
            }
            return text_message;
        },

        forwardMessages: function (ev) {
            var $msgs = this.content_view.$('.chat-message.selected'),
                msgs = [];
            $msgs.each(function (idx, item) {
                var msg = this.messages_arr.get(item.dataset.msgid);
                msg && msgs.push(msg);
            }.bind(this));
            this.resetSelectedMessages();
            if (($(ev.target).hasClass('forward-message'))||($(ev.target).closest('.forward-message').length > 0))
                xabber.forward_panel.open(msgs, this.account);
            if ($(ev.target).hasClass('reply-message'))
                this.setForwardedMessages(msgs);
        },

        showChatNotification: function (message, is_colored) {
            this.$('.chat-notification').text(message)
                .switchClass('text-color-300', is_colored);
        }
    });

    xabber.ChatHeadContainer = xabber.Container.extend({
        className: 'chat-head-container panel-head noselect'
    });

    xabber.ChatBodyContainer = xabber.Container.extend({
        className: 'chat-body-container',

        // TODO: refactor CSS and remove this
        updateHeight: function () {
            var bottom_height = xabber.chat_bottom.$el.height();
            if (bottom_height) {
                this.$el.css({bottom: bottom_height});
                this.view && this.view.updateScrollBar();
            }
        }
    });

    xabber.ChatBottomContainer = xabber.Container.extend({
        className: 'chat-bottom-container'
    });

    xabber.ChatPlaceholderView = xabber.BasicView.extend({
        className: 'placeholder-wrap chat-placeholder-wrap noselect',
        template: templates.chat_placeholder
    });

    xabber.GroupChatPlaceholderView = xabber.BasicView.extend({
        className: 'placeholder-wrap group-chat-placeholder-wrap noselect',
        template: templates.group_chats.group_chat_placeholder
    });

    xabber.ChatSettings = Backbone.ModelWithStorage.extend({
        defaults: {
            last_emoji: [],
            muted: [],
            archived: [],
            group_chat: [],
            cached_avatars: [],
            group_chat_members_lists: []
        },

        getLastEmoji: function () {
            return _.clone(this.get('last_emoji'));
        },

        updateLastEmoji: function (emoji) {
            var last_emoji_icons = _.clone(this.get('last_emoji'));
            if (last_emoji_icons.length > 0) {
                var index = last_emoji_icons.indexOf(emoji);
                if (index != -1)
                    last_emoji_icons.splice(index, 1);
                last_emoji_icons.push(emoji);
                while (last_emoji_icons.length > 7)
                    last_emoji_icons.shift();
            }
            else
                last_emoji_icons.push(emoji);
            this.save('last_emoji', last_emoji_icons);
        },

        updateMutedList: function (jid, muted) {
            var muted_list = _.clone(this.get('muted')),
                index = muted_list.indexOf(jid);
            if (muted && index < 0) {
                muted_list.push(jid);
            }
            if (!muted && index >= 0) {
                muted_list.splice(index, 1);
            }
            this.save('muted', muted_list);
        },

        updateArchiveChatsList: function (jid, archived) {
            var archived_list = _.clone(this.get('archived')),
                index = archived_list.indexOf(jid);
            if (archived && index < 0) {
                archived_list.push(jid);
            }
            if (!archived && index >= 0) {
                archived_list.splice(index, 1);
            }
            this.save('archived', archived_list);
        },

        updateGroupChatsList: function (jid, group_chat) {
            var group_chat_list = _.clone(this.get('group_chat')),
                index = group_chat_list.indexOf(jid);
            if (group_chat && index < 0) {
                group_chat_list.push(jid);
            }
            if (!group_chat && index >= 0) {
                group_chat_list.splice(index, 1);
            }
            this.save('group_chat', group_chat_list);
        },

        updateCachedAvatars: function (id, hash, avatar) {
            var avatar_list = _.clone(this.get('cached_avatars')),
                member = avatar_list.indexOf(avatar_list.find(member => member.id === id));
            if (member != -1) {
                avatar_list.splice(member, 1);
            }
            avatar_list.push({id: id, avatar_hash: hash, avatar_b64: avatar});
            this.save('cached_avatars', avatar_list);
        },

        getAvatarInfoById: function (id) {
            var avatar_list = _.clone(this.get('cached_avatars')),
                result = avatar_list.find(member => member.id === id);
            return result;
        },

        getB64Avatar: function (id) {
            var result = this.getAvatarInfoById(id);
            if (result)
                return result.avatar_b64;
            else
                return;
        },

        getHashAvatar: function (id) {
            var result = this.getAvatarInfoById(id);
            if (result)
                return result.avatar_hash;
        }
    });

    xabber.Account.addInitPlugin(function () {
        this.chat_settings = new xabber.ChatSettings({id: 'chat-settings'}, {
            account: this,
            storage_name: xabber.getStorageName() + '-chat-settings-' + this.get('jid'),
            fetch: 'after'
        });
        this.messages = new xabber.Messages(null, {account: this});
        this.forwarded_messages = new xabber.Messages(null, {account: this});
        this.pinned_messages = new xabber.Messages(null, {account: this});

        this.chats = new xabber.AccountChats(null, {account: this});
    });

    xabber.Account.addConnPlugin(function () {
        this.chats.registerMessageHandler();
        this.chats.each(function (chat) {
            chat.trigger('load_last_history');
        });
        this.trigger('ready_to_get_roster');
    }, true, true);

    xabber.once("start", function () {

        this.chats = new this.Chats;
        this.chats.addCollection(this.opened_chats = new this.OpenedChats);
        this.chats.addCollection(this.closed_chats = new this.ClosedChats);

        this.chats_view = this.left_panel.addChild('chats',
                this.ChatsView, {model: this.opened_chats});
        this.chat_head = this.right_panel.addChild('chat_head',
                this.ChatHeadContainer);
        this.chat_body = this.right_panel.addChild('chat_body',
                this.ChatBodyContainer);
        this.chat_bottom = this.right_panel.addChild('chat_bottom',
                this.ChatBottomContainer);
        this.chat_placeholder = this.right_panel.addChild('chat_placeholder',
                this.ChatPlaceholderView);
        this.group_chat_placeholder = this.right_panel.addChild('group_chat_placeholder',
                this.GroupChatPlaceholderView);
        this.forward_panel = new this.ForwardPanelView({ model: this.opened_chats });

        this.invite_panel = new this.InvitationPanelView({ model: this.opened_chats });

        this.add_group_chat_view = new this.AddGroupChatView();

        this.on("add_group_chat", function () {
            this.add_group_chat_view.show();
        }, this);

        this.on("change:focused", function () {
            if (this.get('focused')) {
                var view = this.chats_view.active_chat;
                if (view && view.model.get('display')) {
                    view.content.readMessages();
                    if (view.model.get('is_accepted') != false)
                        view.content.bottom.focusOnInput();
                }
            }
        }, this);

        this.on("show_group_chats", function () {
            this.chats_view.showGroupChats();
        }, this);

        this.on("show_chats", function () {
            this.chats_view.showChats();
        }, this);

        this.on("show_archive_chats", function () {
            this.chats_view.showArchiveChats();
        }, this);

        this.on("clear_search", function () {
            this.contacts_view.clearSearch();
            this.chats_view.clearSearch();
        }, this);
    }, xabber);

    return xabber;
  };
});
