interface MediaSource {
    url: string;
    width: number;
    height: number;
}

interface MessageEmbed {
    type: string;
    url: string;
    image?: MediaSource;
    video?: MediaSource;
    thumbnail?: MediaSource;
}

interface MessageAttachment extends MediaSource {
    content_type?: string;
}

export interface MediaMessage {
    embeds: MessageEmbed[];
    attachments: MessageAttachment[];
}

export interface FavoriteMedia extends MediaSource {
    src: string;
    format: 1 | 2;
    isVideo?: boolean;
}

export interface FavoriteGif extends FavoriteMedia {
    order: number;
}

export type FavoriteGifs = Record<string, FavoriteGif>;

export function getFilename(url: string): string {
    const path = new URL(url).pathname;
    return path.substring(path.lastIndexOf("/") + 1);
}

export function getHighestOrder(gifs: FavoriteGifs): number {
    // An empty collection must produce a finite order for the first favorite.
    return Math.max(0, ...Object.values(gifs).map(gif => gif.order));
}

export function toFavorite(gifs: FavoriteGifs, media: FavoriteMedia): FavoriteGif {
    return {
        format: media.format,
        src: media.src,
        url: media.url,
        width: media.width,
        height: media.height,
        order: getHighestOrder(gifs) + 1,
    };
}

export function getMessageMedia(message: MediaMessage): FavoriteMedia[] {
    const media: FavoriteMedia[] = [];

    for (const embed of message.embeds) {
        if (embed.type === "gifv" || embed.type === "video") {
            media.push({
                src: embed.video.url,
                url: embed.url,
                width: embed.thumbnail.width,
                height: embed.thumbnail.height,
                format: 2,
                ...(embed.type === "video" ? { isVideo: true } : {}),
            });
        } else if (embed.type === "image") {
            media.push({
                src: embed.image.url,
                url: embed.url,
                width: embed.image.width,
                height: embed.image.height,
                format: 1,
            });
        }
    }

    for (const attachment of message.attachments) {
        const isImage = attachment.content_type?.includes("image");
        const isVideo = !isImage && attachment.content_type?.includes("video");
        if (!isImage && !isVideo) continue;

        media.push({
            src: attachment.url,
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            format: isImage ? 1 : 2,
            ...(isVideo ? { isVideo: true } : {}),
        });
    }

    return media;
}
