import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";

function discordTimestamp(timestamp: string | number | Date) {
    return new Date(timestamp).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

function updateJson(json: any) {
    try {
        if (!json || json.type !== 0 || json.content || json.message_reference?.type !== 1 || !json.message_snapshots?.length) {
            return;
        }

        const message = json.message_snapshots[0].message;
        const ref = json.message_reference;
        const link = `https://discord.com/channels/${ref.guild_id}/${ref.channel_id}/${ref.message_id}`;

        if (!message.content) {
            json.content =
                `> ➜ *Forwarded*\n` +
                `>  *${link} • ${discordTimestamp(message.timestamp)}*`;
        } else {
            const quoted = message.content.split("\n").map(line => `>    ${line}`).join("\n");
            json.content =
                `> ➜ *Forwarded*\n` +
                `> \n` +
                `${quoted}\n` +
                `> \n` +
                `>  *${link} • ${discordTimestamp(message.timestamp)}*`;
        }

        json.mentions = json.mentions.concat(message.mentions ?? []);
        json.mention_roles = json.mention_roles.concat(message.mention_roles ?? []);
        json.attachments = json.attachments.concat(message.attachments ?? []);
        json.embeds = json.embeds.concat(message.embeds ?? []);
        json.components = json.components.concat(message.components ?? []);
        json.flags = 0;
    } catch (err) {
        console.error("[ForwardFixer]: Failed to update message", err);
    }
}

const MessageRecord = findByProps("createMessageRecord", "updateMessageRecord");
const patches: Array<() => void> = [];

export default {
    onLoad() {
		if (!MessageRecord) {
			console.log("[ForwardFixer]: MessageRecord missing, disabling plugin.");
		}
		
		patches.push(instead("createMessageRecord", MessageRecord, (args: any[], orig: Function) => {
			var jsonObj = args[0];
			updateJson(jsonObj)
			return orig(jsonObj);
		}));
		
		patches.push(instead("updateMessageRecord", MessageRecord, (args: any[], orig: Function) => {
			const message = args[0];
			var jsonObj = args[1];
			updateJson(jsonObj)
			return orig(message, jsonObj);
		}));
		
		console.log("[ForwardFixer]: Ready!");
    },

    onUnload() {
		for (const p of patches) {
            try { p(); } catch (e) { console.warn("[ForwardFixer]: failed to unpatch", e); }
        }
        patches.length = 0;
		console.log("[ForwardFixer]: Unloaded!");
	},
};
