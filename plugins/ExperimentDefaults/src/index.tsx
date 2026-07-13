import { findByProps } from "@vendetta/metro";
import { instead } from "@vendetta/patcher";

function experimentOverride(args: any[], orig: Function) {
	const [experimentId] = args;
	if (experimentId === '2023-01_global_display_names' || 
		experimentId === '2022-01_pronouns' || 
		experimentId === '2023-01_silent_messages' || 
		experimentId === '2021-09_favorites_server' ||
		experimentId === '2023-02_discord_embeds' ||
		experimentId === '2023-03_improved_message_markdown' ||
		experimentId === '2023-03_improved_message_markdown_guild') {
		return { type: 1, revision: 1, population: 0, override: true, bucket: 1 };
	}
	return orig(...args);
}

const patches: Array<() => void> = [];
export default {
    onLoad() {
		const prop = findByProps("getExperimentDescriptor");
		const userProp = findByProps("getUserExperimentDescriptor");
		
		patches.push(instead("getUserExperimentDescriptor", userProp, experimentOverride));
		patches.push(instead("getExperimentDescriptor", prop, experimentOverride));
		
		console.log("[ExperimentDefaults]: Ready!");
    },

    onUnload() {
		for (const p of patches) {
            try { p(); } catch (e) { console.warn("[ExperimentDefaults]: failed to unpatch", e); }
        }
        patches.length = 0;
		console.log("[ExperimentDefaults]: Unloaded!");
	},
};