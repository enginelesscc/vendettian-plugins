import { findByProps } from "@vendetta/metro";
import { React, ReactNative, stylesheet } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { semanticColors } from "@vendetta/ui";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms, General } from "@vendetta/ui/components";

const { ScrollView } = General;
const { FormSection, FormSwitchRow, FormIcon, FormRow } = Forms;
const ActionSheetRow = findByProps("ActionSheetRow")?.ActionSheetRow;

interface FavoriteRowProps {
    label: string;
    icon: number;
    onPress: () => void;
}

export function FavoriteRow({ label, icon, onPress }: FavoriteRowProps) {
    const styles = stylesheet.createThemedStyleSheet({
        iconComponent: {
            width: 24,
            height: 24,
            tintColor: semanticColors.INTERACTIVE_NORMAL,
        },
    });

    if (ActionSheetRow) {
        return React.createElement(ActionSheetRow, {
            label,
            icon: React.createElement(ActionSheetRow.Icon, {
                source: icon,
                IconComponent: () => React.createElement(ReactNative.Image, {
                    resizeMode: "cover",
                    style: styles.iconComponent,
                    source: icon,
                }),
            }),
            onPress,
        });
    }

    return React.createElement(FormRow, {
        label,
        leading: React.createElement(FormRow.Icon, { source: icon }),
        onPress,
    });
}

export function Settings() {
    useProxy(storage);
    return React.createElement(ScrollView, { style: { flex: 1 } },
        React.createElement(FormSection, { title: "Settings" },
            React.createElement(FormSwitchRow, {
                label: "Confirm actions",
                subLabel: "Show a confirmation alert before performing actions",
                leading: React.createElement(FormIcon, { source: getAssetIDByName("alert") }),
                value: storage.confirm ?? false,
                onValueChange: (value: boolean) => { storage.confirm = value; },
            }),
        ),
    );
}
