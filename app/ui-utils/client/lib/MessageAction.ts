import _ from 'underscore';
import { FlowRouter } from 'meteor/kadira:flow-router';
import moment from 'moment';
import toastr from 'toastr';
import mem from 'mem';
import { Meteor } from 'meteor/meteor';
import { TAPi18n } from 'meteor/rocketchat:tap-i18n';
import { ReactiveVar } from 'meteor/reactive-var';
import { Tracker } from 'meteor/tracker';
import { Session } from 'meteor/session';

import { messageArgs } from './messageArgs';
import { roomTypes, canDeleteMessage } from '../../../utils/client';
import { Messages, Rooms, Subscriptions } from '../../../models/client';
import { hasAtLeastOnePermission, hasPermission } from '../../../authorization/client';
import { modal } from './modal';
import { IMessage } from '../../../../definition/IMessage';
import { IUser } from '../../../../definition/IUser';


const call = (method: string, ...args: any[]): Promise<any> => new Promise((resolve, reject) => {
	Meteor.call(method, ...args, function(err: any, data: any) {
		if (err) {
			return reject(err);
		}
		resolve(data);
	});
});

export const addMessageToList = (messagesList, message) => {
	// checks if the message is not already on the list
	if (!messagesList.find(({ _id }) => _id === message._id)) {
		messagesList.push(message);
	}

	return messagesList;
};


type MessageActionGroup = 'message' | 'menu';
type MessageActionContext = 'message' | 'thread';

type MessageActionConditionProps = {
	message: IMessage;
	user: IUser;
};

type MessageActionConfig = {
	id: string;
	icont: string;
	label: string;
	order?: number;
	group: MessageActionGroup;
	context: MessageActionContext[];
	action: () => any;
	condition?: ({}) => boolean;
}

type MessageActionConfigList = MessageActionConfig[];

export const MessageAction = new class {
	/*
  	config expects the following keys (only id is mandatory):
  		id (mandatory)
  		icon: string
  		label: string
  		action: function(event, instance)
  		condition: function(message)
			order: integer
			group: string (message or menu)
   */

	buttons = new ReactiveVar<Record<string, MessageActionConfig>>({});

	addButton(config: MessageActionConfig): void{
		if (!config || !config.id) {
			return;
		}

		if (!config.group) {
			config.group = 'menu';
		}

		if (config.condition) {
			config.condition = mem(config.condition, { maxAge: 1000, cacheKey: JSON.stringify });
		}

		return Tracker.nonreactive(() => {
			const btns = this.buttons.get();
			btns[config.id] = config;
			mem.clear(this._getButtons);
			mem.clear(this.getButtonsByGroup);
			return this.buttons.set(btns);
		});
	}

	removeButton(id: MessageActionConfig['id']): void {
		return Tracker.nonreactive(() => {
			const btns = this.buttons.get();
			delete btns[id];
			return this.buttons.set(btns);
		});
	}

	updateButton(id: MessageActionConfig['id'], config: MessageActionConfig): void {
		return Tracker.nonreactive(() => {
			const btns = this.buttons.get();
			if (btns[id]) {
				btns[id] = _.extend(btns[id], config);
				return this.buttons.set(btns);
			}
		});
	}

	getButtonById(id: MessageActionConfig['id']): MessageActionConfig | undefined {
		const allButtons = this.buttons.get();
		return allButtons[id];
	}

	_getButtons = mem((): MessageActionConfigList => {
		return _.sortBy(_.toArray(this.buttons.get()), 'order');
	})

	getButtonsByGroup = mem(function(group: string, arr: MessageActionConfigList = this._getButtons()): MessageActionConfigList {
		return arr.filter((button) => (group && Array.isArray(button.group) ? button.group.includes(group) : button.group === group));
	})

	getButtonsByContext = mem(function(context: MessageActionContext, arr: MessageActionConfigList): MessageActionConfigList {
		return arr.filter((button) => !context || button.context == null || button.context.includes(context));
	})

	getButtons(props: MessageActionConditionProps, context: MessageActionContext, group: MessageActionGroup): MessageActionConfigList {
		const allButtons = this.getButtonsByGroup(group);

		if (props) {
			return this.getButtonsByContext(context, allButtons).filter(function(button) {
				return button.condition == null || button.condition(props);
			});
		}
		return allButtons;
	}

	resetButtons(): void {
		mem.clear(this._getButtons);
		mem.clear(this.getButtonsByGroup);
		return this.buttons.set({});
	}

	async getPermaLink(msgId) {
		if (!msgId) {
			throw new Error('invalid-parameter');
		}

		const msg = Messages.findOne(msgId) || await call('getSingleMessage', msgId);
		if (!msg) {
			throw new Error('message-not-found');
		}
		const roomData = Rooms.findOne({
			_id: msg.rid,
		});

		if (!roomData) {
			throw new Error('room-not-found');
		}

		const subData = Subscriptions.findOne({ rid: roomData._id, 'u._id': Meteor.userId() });
		const roomURL = roomTypes.getURL(roomData.t, subData || roomData);
		return `${ roomURL }?msg=${ msgId }`;
	}
}();

Meteor.startup(async function() {
	const { chatMessages } = await import('../../../ui');

	const getChatMessagesFrom = (msg) => {
		const { rid = Session.get('openedRoom'), tmid = msg._id } = msg;

		return chatMessages[`${ rid }-${ tmid }`] || chatMessages[rid];
	};

	MessageAction.addButton({
		id: 'reply-directly',
		icon: 'reply-directly',
		label: 'Reply_in_direct_message',
		context: ['message', 'message-mobile', 'threads'],
		action() {
			const { msg } = messageArgs(this);
			roomTypes.openRouteLink('d', { name: msg.u.username }, {
				...FlowRouter.current().queryParams,
				reply: msg._id,
			});
		},
		condition({ subscription, room, msg, u }) {
			if (subscription == null) {
				return false;
			}
			if (room.t === 'd' || room.t === 'l') {
				return false;
			}

			// Check if we already have a DM started with the message user (not ourselves) or we can start one
			if (u._id !== msg.u._id && !hasPermission('create-d')) {
				const dmRoom = Rooms.findOne({ _id: [u._id, msg.u._id].sort().join('') });
				if (!dmRoom || !Subscriptions.findOne({ rid: dmRoom._id, 'u._id': u._id })) {
					return false;
				}
			}

			return true;
		},
		order: 0,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'quote-message',
		icon: 'quote',
		label: 'Quote',
		context: ['message', 'message-mobile', 'threads'],
		action() {
			const { msg: message } = messageArgs(this);
			const { input } = getChatMessagesFrom(message);
			const $input = $(input);

			let messages = $input.data('reply') || [];

			messages = addMessageToList(messages, message, input);

			$input
				.focus()
				.data('mention-user', false)
				.data('reply', messages)
				.trigger('dataChange');
		},
		condition({ subscription }) {
			if (subscription == null) {
				return false;
			}

			return true;
		},
		order: -3,
		group: ['message', 'menu'],
	});

	MessageAction.addButton({
		id: 'permalink',
		icon: 'permalink',
		label: 'Get_link',
		classes: 'clipboard',
		context: ['message', 'message-mobile', 'threads'],
		async action() {
			const { msg: message } = messageArgs(this);
			const permalink = await MessageAction.getPermaLink(message._id);
			navigator.clipboard.writeText(permalink);
			toastr.success(TAPi18n.__('Copied'));
		},
		condition({ subscription }) {
			return !!subscription;
		},
		order: 4,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'copy',
		icon: 'copy',
		label: 'Copy',
		classes: 'clipboard',
		context: ['message', 'message-mobile', 'threads'],
		action() {
			const { msg: { msg } } = messageArgs(this);
			navigator.clipboard.writeText(msg);
			toastr.success(TAPi18n.__('Copied'));
		},
		condition({ subscription }) {
			return !!subscription;
		},
		order: 5,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'edit-message',
		icon: 'edit',
		label: 'Edit',
		context: ['message', 'message-mobile', 'threads'],
		action() {
			const { msg } = messageArgs(this);
			getChatMessagesFrom(msg).edit(document.getElementById(msg.tmid ? `thread-${ msg._id }` : msg._id));
		},
		condition({ msg: message, subscription, settings }) {
			if (subscription == null) {
				return false;
			}
			const hasPermission = hasAtLeastOnePermission('edit-message', message.rid);
			const isEditAllowed = settings.Message_AllowEditing;
			const editOwn = message.u && message.u._id === Meteor.userId();
			if (!(hasPermission || (isEditAllowed && editOwn))) {
				return;
			}
			const blockEditInMinutes = settings.Message_AllowEditing_BlockEditInMinutes;
			if (blockEditInMinutes) {
				let msgTs;
				if (message.ts != null) {
					msgTs = moment(message.ts);
				}
				let currentTsDiff;
				if (msgTs != null) {
					currentTsDiff = moment().diff(msgTs, 'minutes');
				}
				return currentTsDiff < blockEditInMinutes;
			}
			return true;
		},
		order: 6,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'delete-message',
		icon: 'trash',
		label: 'Delete',
		context: ['message', 'message-mobile', 'threads'],
		color: 'alert',
		action() {
			const { msg } = messageArgs(this);
			getChatMessagesFrom(msg).confirmDeleteMsg(msg);
		},
		condition({ msg: message, subscription }) {
			if (!subscription) {
				return false;
			}

			return canDeleteMessage({
				rid: message.rid,
				ts: message.ts,
				uid: message.u._id,
			});
		},
		order: 18,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'report-message',
		icon: 'report',
		label: 'Report',
		context: ['message', 'message-mobile', 'threads'],
		color: 'alert',
		action() {
			const { msg: message } = messageArgs(this);
			modal.open({
				title: TAPi18n.__('Report_this_message_question_mark'),
				text: message.msg,
				inputPlaceholder: TAPi18n.__('Why_do_you_want_to_report_question_mark'),
				type: 'input',
				showCancelButton: true,
				confirmButtonColor: '#DD6B55',
				confirmButtonText: TAPi18n.__('Report_exclamation_mark'),
				cancelButtonText: TAPi18n.__('Cancel'),
				closeOnConfirm: false,
				html: false,
			}, (inputValue) => {
				if (inputValue === false) {
					return false;
				}

				if (inputValue === '') {
					modal.showInputError(TAPi18n.__('You_need_to_write_something'));
					return false;
				}

				Meteor.call('reportMessage', message._id, inputValue);

				modal.open({
					title: TAPi18n.__('Report_sent'),
					text: TAPi18n.__('Thank_you_exclamation_mark'),
					type: 'success',
					timer: 1000,
					showConfirmButton: false,
				});
			});
		},
		condition({ subscription }) {
			return Boolean(subscription);
		},
		order: 17,
		group: 'menu',
	});

	MessageAction.addButton({
		id: 'reaction-list',
		icon: 'emoji',
		label: 'Reactions',
		context: ['message', 'message-mobile', 'threads'],
		action(_, { tabBar, rid }) {
			const { msg: { reactions } } = messageArgs(this);

			modal.open({
				template: 'reactionList',
				data: { reactions, tabBar, rid, onClose: () => modal.close() },
			});
		},
		condition({ msg: { reactions } }) {
			return !!reactions;
		},
		order: 18,
		group: 'menu',
	});
});