using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class FormOptionNavigation
{
    public static FormOptionSectionDto[] ForLocale(string locale)
    {
        var zh = locale == "zh-CN";
        return
        [
            new("project", zh ? "项目需求" : "Project requirements",
            [
                new("brands", zh ? "品牌 / 业务方" : "Brand / business"),
                new("video-goals", zh ? "视频目标" : "Video goal"),
                new("audiences", zh ? "目标受众" : "Audience"),
                new("video-durations", zh ? "视频时长" : "Video duration"),
                new("publishing-platforms", zh ? "发布平台" : "Publishing platform"),
            ]),
            new("book", zh ? "书籍资料" : "Book details",
            [
                new("genres", zh ? "书籍题材" : "Book genre"),
                new("content-languages", zh ? "内容语言" : "Content language"),
            ]),
            new("characters", zh ? "角色设定" : "Characters",
            [
                new("role-types", zh ? "角色类型" : "Character role"),
                new("age-ranges", zh ? "年龄范围" : "Age range"),
                new("genders", zh ? "性别表达" : "Gender"),
            ]),
            new("visual", zh ? "视觉方向" : "Visual direction",
            [
                new("visual-styles", zh ? "视觉风格" : "Visual style"),
                new("mood-tags", zh ? "情绪标签" : "Mood tags"),
                new("image-style-tags", zh ? "色彩基调" : "Color tone"),
                new("pace-tags", zh ? "节奏标签" : "Pace tags"),
            ]),
            new("voice", zh ? "旁白配音" : "Narration",
            [
                new("narration-tones", zh ? "旁白语气" : "Narration tone"),
                new("speech-rates", zh ? "语速" : "Speech rate"),
                new("voice-genders", zh ? "声音性别" : "Voice gender"),
                new("voice-ages", zh ? "声音年龄感" : "Voice age"),
                new("accents", zh ? "口音" : "Accent"),
                new("voice-emotions", zh ? "配音情绪" : "Voice emotion"),
                new("voice-tags", zh ? "音色标签" : "Voice tags"),
            ]),
        ];
    }
}
