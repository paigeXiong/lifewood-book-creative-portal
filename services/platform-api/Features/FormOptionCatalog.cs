using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class FormOptionCatalog
{
    public const int MaxSelectedVoices = 4;
    public static readonly IReadOnlySet<string> BrandIds = Set("lifewood", "deseret-book", "independent");
    public static readonly IReadOnlySet<string> VideoGoalIds = Set("book-trailer", "social-promotion", "author-event", "internal-presentation");
    public static readonly IReadOnlySet<string> AudienceIds = Set("young-adults", "families", "educators", "general");
    public static readonly IReadOnlySet<string> GenreIds = Set("adventure", "inspirational", "history", "education", "fiction");
    public static readonly IReadOnlySet<string> ContentLanguageIds = Set("en-US", "en-GB", "zh-CN");
    public static readonly IReadOnlySet<string> VideoDurationIds = Set("30s", "60s", "90s", "custom");
    public static readonly IReadOnlySet<string> PublishingPlatformIds = Set("youtube", "instagram", "tiktok", "website", "event");
    public static readonly IReadOnlySet<string> RoleTypeIds = Set("protagonist", "supporting", "narrator", "mentor", "antagonist", "child", "background");
    public static readonly IReadOnlySet<string> AgeRangeIds = Set("child", "teen", "young-adult", "adult", "senior", "unspecified");
    public static readonly IReadOnlySet<string> GenderIds = Set("female", "male", "neutral", "unspecified");
    public static readonly IReadOnlySet<string> VisualStyleIds = Set("cinematic", "storybook", "editorial", "watercolor", "animation-3d", "motion-graphics");
    public static readonly IReadOnlySet<string> MoodTagIds = Set("warm", "hopeful", "mysterious", "tense", "playful", "reflective");
    public static readonly IReadOnlySet<string> ImageStyleTagIds = Set("natural-light", "high-contrast", "soft-texture", "graphic-shapes", "vintage", "modern");
    public static readonly IReadOnlySet<string> PaceTagIds = Set("slow", "measured", "dynamic", "fast");
    public static readonly IReadOnlySet<string> NarrationToneIds = Set("inspiring", "warm", "calm", "authoritative", "intimate");
    public static readonly IReadOnlySet<string> SpeechRateIds = Set("slow", "medium", "fast");
    public static readonly IReadOnlySet<string> VoiceGenderIds = Set("female", "male", "neutral", "unspecified");
    public static readonly IReadOnlySet<string> VoiceAgeIds = Set("young-adult", "adult", "mature", "unspecified");
    public static readonly IReadOnlySet<string> AccentIds = Set("neutral-us", "neutral-uk", "mandarin", "unspecified");
    public static readonly IReadOnlySet<string> VoiceEmotionIds = Set("warm", "confident", "calm", "energetic", "reflective");
    public static readonly IReadOnlySet<string> SourceCategoryIds = Set("book-cover", "manuscript", "key-chapters", "brand-guidelines", "authorization", "supplemental-images");
    public static readonly IReadOnlySet<string> ReferenceCategoryIds = Set("sample-video", "sample-image", "moodboard", "competitor", "scene-notes", "dos-donts");

    public static FormOptionsDto ForLocale(string locale)
    {
        var en = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        return new FormOptionsDto(
            Brands:
            [
                Option("lifewood", en ? "Lifewood" : "Lifewood"),
                Option("deseret-book", en ? "Deseret Book" : "Deseret Book"),
                Option("independent", en ? "Independent author" : "独立作者")
            ],
            VideoGoals:
            [
                Option("book-trailer", en ? "Book trailer" : "图书预告片"),
                Option("social-promotion", en ? "Social promotion" : "社交媒体推广"),
                Option("author-event", en ? "Author event" : "作者活动"),
                Option("internal-presentation", en ? "Internal presentation" : "内部展示")
            ],
            Audiences:
            [
                Option("young-adults", en ? "Young adults" : "青少年"),
                Option("families", en ? "Families" : "家庭"),
                Option("educators", en ? "Educators" : "教育工作者"),
                Option("general", en ? "General audience" : "大众")
            ],
            Genres:
            [
                Option("adventure", en ? "Adventure" : "冒险"),
                Option("inspirational", en ? "Inspirational" : "励志"),
                Option("history", en ? "History" : "历史"),
                Option("education", en ? "Education" : "教育"),
                Option("fiction", en ? "Fiction" : "小说")
            ],
            ContentLanguages:
            [
                Option("en-US", en ? "English (US)" : "英语（美国）"),
                Option("en-GB", en ? "English (UK)" : "英语（英国）"),
                Option("zh-CN", en ? "Chinese (Simplified)" : "简体中文")
            ],
            VideoDurations:
            [
                Option("30s", en ? "30 seconds" : "30 秒"),
                Option("60s", en ? "60 seconds" : "60 秒"),
                Option("90s", en ? "90 seconds" : "90 秒"),
                Option("custom", en ? "Custom" : "自定义")
            ],
            PublishingPlatforms:
            [
                Option("youtube", "YouTube"),
                Option("instagram", "Instagram"),
                Option("tiktok", "TikTok"),
                Option("website", en ? "Website" : "官方网站"),
                Option("event", en ? "Live event" : "线下活动")
            ],
            TaskStatuses:
            [
                Option("draft", en ? "Draft" : "草稿", "neutral"),
                Option("validating", en ? "Validating" : "校验中", "info"),
                Option("submitting", en ? "Submitting" : "提交中", "info"),
                Option("submitted", en ? "Submitted" : "已提交", "success"),
                Option("submission_failed", en ? "Submission failed" : "提交失败", "danger")
            ],
            RoleTypes:
            [
                Option("protagonist", en ? "Protagonist" : "主角"), Option("supporting", en ? "Supporting character" : "配角"),
                Option("narrator", en ? "Narrator" : "旁白"), Option("mentor", en ? "Mentor" : "导师"),
                Option("antagonist", en ? "Antagonist" : "反派"), Option("child", en ? "Child" : "儿童"),
                Option("background", en ? "Background character" : "背景角色")
            ],
            AgeRanges:
            [
                Option("child", en ? "Child" : "儿童"), Option("teen", en ? "Teen" : "青少年"),
                Option("young-adult", en ? "Young adult" : "青年"), Option("adult", en ? "Adult" : "成年"),
                Option("senior", en ? "Senior" : "老年"), Option("unspecified", en ? "Not specified" : "不指定")
            ],
            Genders:
            [
                Option("female", en ? "Female" : "女性"), Option("male", en ? "Male" : "男性"),
                Option("neutral", en ? "Neutral" : "中性"), Option("unspecified", en ? "Not specified" : "不指定")
            ],
            VisualStyles:
            [
                Option("cinematic", en ? "Cinematic realism" : "电影写实", null, "#244D3A"),
                Option("storybook", en ? "Storybook illustration" : "故事书插画", null, "#D89A58"),
                Option("editorial", en ? "Minimal editorial" : "极简编辑风", null, "#D8D4C7"),
                Option("watercolor", en ? "Watercolor" : "水彩", null, "#8DB7B2"),
                Option("animation-3d", en ? "3D animation" : "3D 动画", null, "#725F8D"),
                Option("motion-graphics", en ? "Premium motion graphics" : "高级动态图形", null, "#C45F3C")
            ],
            MoodTags: [Option("warm", en ? "Warm" : "温暖"), Option("hopeful", en ? "Hopeful" : "希望"), Option("mysterious", en ? "Mysterious" : "神秘"), Option("tense", en ? "Tense" : "紧张"), Option("playful", en ? "Playful" : "轻快"), Option("reflective", en ? "Reflective" : "沉思")],
            ImageStyleTags: [Option("natural-light", en ? "Natural light" : "自然光"), Option("high-contrast", en ? "High contrast" : "高对比"), Option("soft-texture", en ? "Soft texture" : "柔和质感"), Option("graphic-shapes", en ? "Graphic shapes" : "图形构成"), Option("vintage", en ? "Vintage" : "复古"), Option("modern", en ? "Modern" : "现代")],
            PaceTags: [Option("slow", en ? "Slow" : "舒缓"), Option("measured", en ? "Measured" : "从容"), Option("dynamic", en ? "Dynamic" : "动感"), Option("fast", en ? "Fast" : "快速")],
            NarrationTones: [Option("inspiring", en ? "Inspiring" : "励志"), Option("warm", en ? "Warm" : "温暖"), Option("calm", en ? "Calm" : "冷静"), Option("authoritative", en ? "Authoritative" : "权威"), Option("intimate", en ? "Intimate" : "亲切")],
            SpeechRates: [Option("slow", en ? "Slow" : "慢速"), Option("medium", en ? "Medium" : "适中"), Option("fast", en ? "Fast" : "快速")],
            VoiceGenders: [Option("female", en ? "Female" : "女性"), Option("male", en ? "Male" : "男性"), Option("neutral", en ? "Neutral" : "中性"), Option("unspecified", en ? "No preference" : "不指定")],
            VoiceAges: [Option("young-adult", en ? "Young adult" : "青年"), Option("adult", en ? "Adult" : "成年"), Option("mature", en ? "Mature" : "成熟"), Option("unspecified", en ? "No preference" : "不指定")],
            Accents: [Option("neutral-us", en ? "Neutral US English" : "标准美式英语"), Option("neutral-uk", en ? "Neutral UK English" : "标准英式英语"), Option("mandarin", en ? "Standard Mandarin" : "普通话"), Option("unspecified", en ? "No preference" : "不指定")],
            VoiceEmotions: [Option("warm", en ? "Warm" : "温暖"), Option("confident", en ? "Confident" : "自信"), Option("calm", en ? "Calm" : "沉稳"), Option("energetic", en ? "Energetic" : "活力"), Option("reflective", en ? "Reflective" : "沉思")],
            VoiceTags: [Option("warm", en ? "Warm" : "温暖"), Option("natural", en ? "Natural" : "自然"), Option("grounded", en ? "Grounded" : "沉稳"), Option("professional", en ? "Professional" : "专业"), Option("bright", en ? "Bright" : "明亮"), Option("clear", en ? "Clear" : "清晰")],
            SourceCategories:
            [
                Category("book-cover", en ? "Book cover" : "图书封面", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 10_000_000, 1, required: true),
                Category("manuscript", en ? "Manuscript or excerpt" : "全书或节选", en ? "PDF, DOCX, or TXT" : "PDF、DOCX 或 TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 200_000_000, 1, required: true),
                Category("key-chapters", en ? "Chapter highlights" : "章节要点", en ? "PDF or DOCX" : "PDF 或 DOCX", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], 50_000_000, 5),
                Category("brand-guidelines", en ? "Brand guide" : "品牌规范", "PDF", ["application/pdf"], 50_000_000, 1),
                Category("authorization", en ? "Rights / approval confirmation" : "授权确认", en ? "PDF or DOCX" : "PDF 或 DOCX", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], 20_000_000, 1),
                Category("supplemental-images", en ? "Optional images / phone photos" : "补充图片 / 手机照片", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 8)
            ],
            ReferenceCategories:
            [
                Category("sample-video", en ? "Example video" : "示例视频", en ? "MP4 or MOV" : "MP4 或 MOV", ["video/mp4", "video/quicktime"], 500_000_000, 3),
                Category("sample-image", en ? "Example images" : "示例图片", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 10),
                Category("moodboard", en ? "Moodboard" : "情绪板", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 10),
                Category("competitor", en ? "Competitive examples / links" : "竞品示例 / 链接", en ? "PDF or image; links are also supported" : "PDF 或图片；也支持链接", ["application/pdf", "image/jpeg", "image/png"], 20_000_000, 5, true),
                Category("scene-notes", en ? "Scene notes" : "场景说明", en ? "PDF, DOCX, or TXT" : "PDF、DOCX 或 TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 10_000_000, 5),
                Category("dos-donts", en ? "Do / Don't notes" : "注意事项", en ? "PDF, DOCX, or TXT" : "PDF、DOCX 或 TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 10_000_000, 5)
            ],
            MaxSelectedVoices: MaxSelectedVoices);
    }

    public static VoiceReferenceDto[] VoicesForLocale(string locale)
    {
        var en = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        return
        [
            new("warm-storyteller", en ? "Warm storyteller" : "温暖讲述者", en ? "Gentle, natural delivery for reflective stories." : "自然柔和，适合温情和回忆类故事。", "/api/voices/warm-storyteller/sample", ["warm", "natural"], true, true),
            new("grounded-narrator", en ? "Grounded narrator" : "沉稳旁白", en ? "Measured and dependable for substantial themes." : "节奏从容，适合厚重或专业主题。", "/api/voices/grounded-narrator/sample", ["grounded", "professional"], false, true),
            new("bright-guide", en ? "Bright guide" : "明亮引导者", en ? "Open and energetic for youthful audiences." : "开放有活力，适合年轻受众。", "/api/voices/bright-guide/sample", ["bright", "natural"], false, true),
            new("clear-editorial", en ? "Clear editorial voice" : "清晰编辑型", en ? "Precise and polished for information-led videos." : "清晰克制，适合信息主导的视频。", "/api/voices/clear-editorial/sample", ["clear", "professional"], false, true)
        ];
    }

    public static IReadOnlySet<string> EnabledVoiceIds() => VoicesForLocale("en-US").Where(voice => voice.Enabled).Select(voice => voice.Id).ToHashSet(StringComparer.Ordinal);

    private static ConfigOptionDto Option(string id, string label, string? tone = null, string? previewColor = null) => new(id, label, null, tone, previewColor);
    private static ReferenceCategoryDto Category(string id, string label, string description, string[] accept, long maxBytes, int maxFiles, bool allowsUrl = false, bool required = false) => new(id, label, description, accept, maxBytes, maxFiles, allowsUrl, required);
    private static IReadOnlySet<string> Set(params string[] values) => new HashSet<string>(values, StringComparer.Ordinal);
}
