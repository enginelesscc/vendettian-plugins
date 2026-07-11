import { plugin } from "@vendetta";
import { findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";

const { ScrollView } = findByProps("ScrollView")
const { Stack } = findByProps("Stack")
const { Text } = findByProps("Text")
const { Pressable } = findByProps("Pressable")
const { View } = findByProps("View")

const GridQualities = ["gif", "tinygif", "nanogif"] as const;

const labels: Record<string, { label: string; subLabel: string }> = {
    gif: { label: "GIF", subLabel: "Original quality, ~500px — slowest" },
    tinygif: { label: "TinyGIF", subLabel: "Small animated thumbnail, ~200px — default" },
    nanogif: { label: "NanoGIF", subLabel: "Tiny thumbnail, ~100px — fastest" },
};

const get = (key: string, fallback: any) => plugin.storage[key] ?? fallback;
const set = (key: string, value: any) => { plugin.storage[key] = value; };

export default function BringBackTenorSettings() {
    const [, forceUpdate] = React.useReducer((x: number) => ~x, 0);

    const gridQuality = get("gridQuality", "tinygif");

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ padding: 16 }} spacing={16}>
                <Stack spacing={8}>
                    <Text>Grid Quality</Text>

                    {GridQualities.map(q => (
                        <Pressable
                            key={q}
                            onPress={() => {
                                set("gridQuality", q);
                                forceUpdate();
                            }}
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                            }}
                        >
                            <View
                                style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 10,
                                    borderWidth: 2,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginRight: 8,
                                }}
                            >
                                {gridQuality === q && (
                                    <View
                                        style={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: 5,
                                        }}
                                    />
                                )}
                            </View>

                            <Stack>
                                <Text>{labels[q].label}</Text>
                                <Text>{labels[q].subLabel}</Text>
                            </Stack>
                        </Pressable>
                    ))}
                </Stack>
            </Stack>
        </ScrollView>
    );
}