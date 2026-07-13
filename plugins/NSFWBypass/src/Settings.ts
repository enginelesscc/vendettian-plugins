import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { React, ReactNative as RN } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { semanticColors } from "@vendetta/ui";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { url } from "@vendetta/metro/common";

const { FormSection, FormRow, FormSwitchRow, FormText, FormInput } = findByProps("FormSection");

const WarningContent = () => {
    return React.createElement(
        RN.Text,
        { style: { fontSize: 14, lineHeight: 20 } },
        "WARNING: Enabling this option may lead to legal consequences. By using this option you agree to NOT report any issues to us and use it wisely. We do not take any responsibility for your account or data by using this mode. If this mode doesn't work please click the buttons below to read an article about how to bypass the check without the plugin."
    );
};

interface SettingsProps {}

export const Settings: React.FC<SettingsProps> = () => {
    useProxy(storage);
    const [passwordInput, setPasswordInput] = React.useState("");
    const [showPasswordInput, setShowPasswordInput] = React.useState(false);

    storage.ageBypass ??= false;
    storage.nsfwBypass ??= true;
    storage.showWarningPopup ??= true;
    storage.lockNSFWChannels ??= false;
    storage.nsfwPassword ??= "";

    const handleSetPassword = () => {
        if (showPasswordInput) {
            if (passwordInput.length > 0) {
                storage.nsfwPassword = passwordInput;
                setPasswordInput("");
                setShowPasswordInput(false);
                
                console.log("NSFW password set successfully");
            }
        } else {
            setShowPasswordInput(true);
        }
    };

    const handleCancelPassword = () => {
        setPasswordInput("");
        setShowPasswordInput(false);
    };

    const handleVisualA11yToggle = (enabled: boolean) => {
        if (enabled && !storage.ageBypass) {
            showConfirmationAlert({
                title: "⚠️ Legal Warning",
                content: React.createElement(WarningContent),
                confirmText: "I Understand and Accept",
                cancelText: "Cancel",
                onConfirm: () => {
                    // Show second confirmation after first one
                    showConfirmationAlert({
                        title: "Hang on!",
                        content: React.createElement(
                            RN.Text,
                            { style: { fontSize: 14, lineHeight: 20 } },
                            "Please confirm you are over 18 years of age and update your settings to see potentially inappropriate and sensitive content."
                        ),
                        confirmText: "I'm 18+ and Accept",
                        cancelText: "Cancel",
                        onConfirm: () => {
                            storage.ageBypass = true;
                        },
                    });
                },
            });
        } else if (!enabled) {
            storage.ageBypass = false;
        }
    };

    const openDocsLink = () => {
        url.openURL("https://github.com/ApexTeamPL/Apex-Plugins/tree/master/docs/nsfwbypass");
    };

    return React.createElement(
        RN.ScrollView,
        { style: { flex: 1 } },
        React.createElement(
            FormSection,
            { title: "Accessibility Settings" },
            React.createElement(
                FormText,
                {
                    style: {
                        color: "#FFFFFF",
                        marginBottom: 16,
                        fontSize: 15,
                        fontWeight: "500"
                    }
                },
                "Configure accessibility features. Restart app to apply changes."
            ),
            React.createElement(FormSwitchRow, {
                label: "🌟 Enhanced Visual Accessibility",
                subLabel: "⚠️ Advanced visual enhancement features - Use with caution",
                leading: React.createElement(FormRow.Icon, {
                    source: findByProps("getAssetByName")?.getAssetByName("ic_accessibility")?.id || findByProps("getAssetByName")?.getAssetByName("ic_person")?.id
                }),
                value: storage.ageBypass,
                onValueChange: handleVisualA11yToggle
            }),
            React.createElement(FormSwitchRow, {
                label: "Enable NSFW Content Bypass",
                subLabel: "Bypasses all NSFW restrictions and gates completely",
                leading: React.createElement(FormRow.Icon, {
                    source: findByProps("getAssetByName")?.getAssetByName("ic_warning")?.id
                }),
                value: storage.nsfwBypass,
                onValueChange: (value: boolean) => {
                    storage.nsfwBypass = value;
                }
            }),
            React.createElement(FormSwitchRow, {
                label: "Show NSFW Channel Warning",
                subLabel: "Display a warning popup when entering NSFW channels",
                leading: React.createElement(FormRow.Icon, {
                    source: findByProps("getAssetByName")?.getAssetByName("ic_alert")?.id
                }),
                value: storage.showWarningPopup,
                onValueChange: (value: boolean) => {
                    storage.showWarningPopup = value;
                }
            }),
            React.createElement(FormSwitchRow, {
                label: "🔒 Lock NSFW Channels",
                subLabel: storage.nsfwPassword ? "Password protected NSFW channel access" : "Set a password to enable NSFW channel locking",
                leading: React.createElement(FormRow.Icon, {
                    source: findByProps("getAssetByName")?.getAssetByName("ic_lock")?.id
                }),
                value: storage.lockNSFWChannels,
                onValueChange: (value: boolean) => {
                    if (value && !storage.nsfwPassword) {
                        
                        setShowPasswordInput(true);
                    } else {
                        storage.lockNSFWChannels = value;
                    }
                }
            }),
        
            React.createElement(
                RN.View,
                { style: { marginHorizontal: 16, marginVertical: 8 } },
                React.createElement(
                    RN.TouchableOpacity,
                    {
                        style: {
                            backgroundColor: semanticColors.BUTTON_SECONDARY_BACKGROUND,
                            padding: 12,
                            borderRadius: 8,
                            alignItems: "center",
                            marginBottom: 8
                        },
                        onPress: handleSetPassword
                    },
                    React.createElement(
                        RN.Text,
                        {
                            style: {
                                color: "#FFFFFF",
                                fontSize: 14,
                                fontWeight: "500"
                            }
                        },
                        storage.nsfwPassword ? "Change NSFW Password" : "Set NSFW Password"
                    )
                )
            ),
            
            showPasswordInput ? React.createElement(
                RN.View,
                { style: { marginHorizontal: 16, marginBottom: 16 } },
                React.createElement(FormInput, {
                    title: "NSFW Password",
                    placeholder: "Enter password for NSFW channels",
                    value: passwordInput,
                    onChange: setPasswordInput,
                    secureTextEntry: true
                }),
                React.createElement(
                    RN.View,
                    { style: { flexDirection: "row", gap: 8, marginTop: 8 } },
                    React.createElement(
                        RN.TouchableOpacity,
                        {
                            style: {
                                backgroundColor: semanticColors.BUTTON_POSITIVE_BACKGROUND,
                                padding: 8,
                                borderRadius: 6,
                                flex: 1,
                                alignItems: "center"
                            },
                            onPress: handleSetPassword
                        },
                        React.createElement(
                            RN.Text,
                            { style: { color: "#FFFFFF", fontSize: 12, fontWeight: "bold" } },
                            "Set Password"
                        )
                    ),
                    React.createElement(
                        RN.TouchableOpacity,
                        {
                            style: {
                                backgroundColor: semanticColors.BUTTON_DANGER_BACKGROUND,
                                padding: 8,
                                borderRadius: 6,
                                flex: 1,
                                alignItems: "center"
                            },
                            onPress: handleCancelPassword
                        },
                        React.createElement(
                            RN.Text,
                            { style: { color: "#FFFFFF", fontSize: 12, fontWeight: "bold" } },
                            "Cancel"
                        )
                    )
                )
            ) : null
        ),
        React.createElement(
            FormSection,
            { title: "Documentation" },
            React.createElement(
                RN.TouchableOpacity,
                {
                    style: {
                        backgroundColor: semanticColors.BACKGROUND_SECONDARY,
                        padding: 16,
                        margin: 16,
                        borderRadius: 8,
                        alignItems: "center"
                    },
                    onPress: openDocsLink
                },
                React.createElement(
                    RN.Text,
                    {
                        style: {
                            color: "#FFFFFF",
                            fontSize: 16,
                            fontWeight: "500"
                        }
                    },
                    "📖 Note"
                ),
                React.createElement(
                    RN.Text,
                    {
                        style: {
                            color: "#FFFFFF",
                            fontSize: 12,
                            marginTop: 4
                        }
                    },
                    "Read documentation and alternative bypass methods. Please note this plugin was tested on 290+. We won't support any versions below 290 as stated in Vencore docs (click here to read more)."
                )
            )
        )
    );
};
