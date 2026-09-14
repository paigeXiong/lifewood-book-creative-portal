using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class FormOptionCatalog
{
    public const int MaxSelectedVoices = 4;
    public static readonly IReadOnlySet<string> BrandIds = Set("lifewood", "deseret-book", "independent");
    public static readonly IReadOnlySet<string> VideoGoalIds = Set(
        "brand-awareness", "launch-promotion", "audience-engagement", "sales-conversion",
        "knowledge-communication", "event-support", "internal-communication");
    public static readonly IReadOnlySet<string> AudienceIds = Set(
        "children", "young-adults", "adults", "families", "educators", "professionals", "seniors", "general");
    public static readonly IReadOnlySet<string> GenreIds = Set(
        "fiction", "nonfiction", "children-young-adult", "biography-memoir", "education-academic",
        "business-professional", "self-help-lifestyle", "religion-spirituality", "history-society",
        "arts-culture", "poetry-literature", "comics-graphic-novels");
    public static readonly IReadOnlySet<string> ContentLanguageIds = Set(
        "en-US", "en-GB", "zh-CN", "zh-TW", "es-419", "fr-FR", "de-DE", "pt-BR",
        "it-IT", "ja-JP", "ko-KR", "ar", "hi-IN", "id-ID", "vi-VN", "th-TH");
    public static readonly IReadOnlySet<string> VideoDurationIds = Set("15s", "30s", "45s", "60s", "90s", "120s", "custom");
    public static readonly IReadOnlySet<string> PublishingPlatformIds = Set(
        "youtube", "instagram", "facebook", "linkedin", "x", "vimeo", "amazon",
        "website", "email-newsletter", "event");
    public static readonly IReadOnlySet<string> RoleTypeIds = Set("protagonist", "supporting", "narrator", "mentor", "antagonist", "child", "background");
    public static readonly IReadOnlySet<string> AgeRangeIds = Set("child", "teen", "young-adult", "adult", "senior", "unspecified");
    public static readonly IReadOnlySet<string> GenderIds = Set("female", "male", "neutral", "unspecified");
    public static readonly IReadOnlySet<string> VisualStyleIds = Set("cinematic", "storybook", "editorial", "watercolor", "animation-3d", "motion-graphics");
    public static readonly IReadOnlySet<string> MoodTagIds = Set("warm", "hopeful", "mysterious", "tense", "playful", "reflective");
    public static readonly IReadOnlySet<string> ImageStyleTagIds = Set("natural-color", "warm-tone", "cool-tone", "black-and-white");
    public static readonly IReadOnlySet<string> PaceTagIds = Set("slow", "measured", "dynamic", "fast");
    public static readonly IReadOnlySet<string> NarrationToneIds = Set("inspiring", "warm", "calm", "authoritative", "intimate");
    public static readonly IReadOnlySet<string> SpeechRateIds = Set("slow", "medium", "fast");
    public static readonly IReadOnlySet<string> VoiceGenderIds = Set("female", "male", "neutral", "unspecified");
    public static readonly IReadOnlySet<string> VoiceAgeIds = Set("young-adult", "adult", "mature", "unspecified");
    public static readonly IReadOnlySet<string> AccentIds = Set("neutral-us", "neutral-uk", "mandarin", "unspecified");
    public static readonly IReadOnlySet<string> VoiceEmotionIds = Set("warm", "confident", "calm", "energetic", "reflective");

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
                Option("brand-awareness", en ? "Brand awareness" : "品牌认知"),
                Option("launch-promotion", en ? "Launch promotion" : "上市推广"),
                Option("audience-engagement", en ? "Audience engagement" : "受众互动"),
                Option("sales-conversion", en ? "Sales conversion" : "销售转化"),
                Option("knowledge-communication", en ? "Knowledge communication" : "知识传播"),
                Option("event-support", en ? "Event support" : "活动支持"),
                Option("internal-communication", en ? "Internal communication" : "内部沟通")
            ],
            Audiences:
            [
                Option("children", en ? "Children" : "儿童"),
                Option("young-adults", en ? "Young adults" : "青少年"),
                Option("adults", en ? "Adults" : "成年人"),
                Option("families", en ? "Families" : "家庭"),
                Option("educators", en ? "Educators" : "教育工作者"),
                Option("professionals", en ? "Industry professionals" : "行业从业者"),
                Option("seniors", en ? "Seniors" : "银发人群"),
                Option("general", en ? "General audience" : "大众")
            ],
            Genres:
            [
                Option("fiction", en ? "Fiction" : "小说"),
                Option("nonfiction", en ? "Nonfiction" : "非虚构"),
                Option("children-young-adult", en ? "Children and young adult" : "儿童与青少年读物"),
                Option("biography-memoir", en ? "Biography and memoir" : "传记与回忆录"),
                Option("education-academic", en ? "Education and academic" : "教育与学术"),
                Option("business-professional", en ? "Business and professional" : "商业与专业"),
                Option("self-help-lifestyle", en ? "Self-help and lifestyle" : "个人成长与生活"),
                Option("religion-spirituality", en ? "Religion and spirituality" : "宗教与心灵成长"),
                Option("history-society", en ? "History and society" : "历史与社会"),
                Option("arts-culture", en ? "Arts and culture" : "艺术与文化"),
                Option("poetry-literature", en ? "Poetry and literature" : "诗歌与文学"),
                Option("comics-graphic-novels", en ? "Comics and graphic novels" : "漫画与图像小说")
            ],
            ContentLanguages:
            [
                Option("en-US", "English (United States)"),
                Option("en-GB", "English (United Kingdom)"),
                Option("zh-CN", "简体中文"),
                Option("zh-TW", "繁體中文"),
                Option("es-419", "Español (Latinoamérica)"),
                Option("fr-FR", "Français"),
                Option("de-DE", "Deutsch"),
                Option("pt-BR", "Português (Brasil)"),
                Option("it-IT", "Italiano"),
                Option("ja-JP", "日本語"),
                Option("ko-KR", "한국어"),
                Option("ar", "العربية"),
                Option("hi-IN", "हिन्दी"),
                Option("id-ID", "Bahasa Indonesia"),
                Option("vi-VN", "Tiếng Việt"),
                Option("th-TH", "ไทย")
            ],
            VideoDurations:
            [
                Option("15s", en ? "15 seconds" : "15 秒"),
                Option("30s", en ? "30 seconds" : "30 秒"),
                Option("45s", en ? "45 seconds" : "45 秒"),
                Option("60s", en ? "60 seconds" : "60 秒"),
                Option("90s", en ? "90 seconds" : "90 秒"),
                Option("120s", en ? "120 seconds" : "120 秒"),
                Option("custom", en ? "Custom" : "自定义", allowsCustomValue: true)
            ],
            PublishingPlatforms:
            [
                Option("youtube", "YouTube"),
                Option("instagram", "Instagram"),
                Option("facebook", "Facebook"),
                Option("linkedin", "LinkedIn"),
                Option("x", "X (Twitter)"),
                Option("vimeo", "Vimeo"),
                Option("amazon", en ? "Amazon book page" : "Amazon 图书页面"),
                Option("website", en ? "Website" : "官方网站"),
                Option("email-newsletter", en ? "Email newsletter" : "电子邮件简报"),
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
                Style("cinematic", en ? "Cinematic realism" : "电影写实", "#244D3A"),
                Style("storybook", en ? "Storybook illustration" : "故事书插画", "#D89A58"),
                Style("editorial", en ? "Minimal editorial" : "极简编辑风", "#D8D4C7"),
                Style("watercolor", en ? "Watercolor" : "水彩", "#8DB7B2"),
                Style("animation-3d", en ? "3D animation" : "3D 动画", "#725F8D"),
                Style("motion-graphics", en ? "Premium motion graphics" : "高级动态图形", "#C45F3C")
            ],
            MoodTags: [Option("warm", en ? "Warm" : "温暖"), Option("hopeful", en ? "Hopeful" : "希望"), Option("mysterious", en ? "Mysterious" : "神秘"), Option("tense", en ? "Tense" : "紧张"), Option("playful", en ? "Playful" : "轻快"), Option("reflective", en ? "Reflective" : "沉思")],
            ImageStyleTags: [Option("natural-color", en ? "Natural colors" : "自然原色"), Option("warm-tone", en ? "Warm tones" : "暖色调"), Option("cool-tone", en ? "Cool tones" : "冷色调"), Option("black-and-white", en ? "Black and white" : "黑白")],
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
                Category("book-cover", en ? "Book cover" : "图书封面", en ? "JPG or PNG; up to 6 cover photos" : "JPG 或 PNG；最多 6 张封面照片", ["image/jpeg", "image/png"], 10_000_000, 6, required: true),
                Category("manuscript", en ? "Book text" : "书籍正文", en ? "Full book or selected chapters · Optional · PDF, DOCX, or TXT" : "可上传全书或部分章节，选填。支持 PDF、DOCX、TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 200_000_000, 1),
                Category("supplemental-images", en ? "Optional images / phone photos" : "补充图片 / 手机照片", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 8)
            ],
            ReferenceCategories:
            [
                Category("character-reference", en ? "Character reference images" : "角色参考图", en ? "JPG, PNG, or WebP; up to 6 per character" : "JPG、PNG 或 WebP；每个角色最多 6 张", ["image/jpeg", "image/png", "image/webp"], 20_000_000, 6),
                Category("style-reference", en ? "Visual style reference images" : "风格参考图", en ? "JPG, PNG, or WebP; up to 6 images" : "JPG、PNG 或 WebP；最多 6 张", ["image/jpeg", "image/png", "image/webp"], 20_000_000, 6),
                Category("sample-video", en ? "Example video" : "示例视频", en ? "MP4 or MOV" : "MP4 或 MOV", ["video/mp4", "video/quicktime"], 500_000_000, 3),
                Category("sample-image", en ? "Example images" : "示例图片", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 10),
                Category("moodboard", en ? "Visual inspiration board" : "风格参考拼图", en ? "JPG or PNG" : "JPG 或 PNG", ["image/jpeg", "image/png"], 20_000_000, 10),
                Category("competitor", en ? "Competitive examples / links" : "竞品示例 / 链接", en ? "PDF or image; links are also supported" : "PDF 或图片；也支持链接", ["application/pdf", "image/jpeg", "image/png"], 20_000_000, 5, true),
                Category("scene-notes", en ? "Scene notes" : "场景说明", en ? "PDF, DOCX, or TXT" : "PDF、DOCX 或 TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 10_000_000, 5),
                Category("dos-donts", en ? "Do / Don't notes" : "注意事项", en ? "PDF, DOCX, or TXT" : "PDF、DOCX 或 TXT", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"], 10_000_000, 5)
            ],
            MaxSelectedVoices: MaxSelectedVoices,
            WorkflowStatuses:
            [
                Option("new", en ? "Needs follow-up" : "待跟进", "warning"),
                Option("contacting", en ? "Contacting" : "沟通中", "warning"),
                Option("confirmed", en ? "Confirmed" : "已确认", "info"),
                Option("in_production", en ? "In production" : "制作中", "info"),
                Option("awaiting_customer", en ? "Awaiting customer" : "待客户确认", "warning"),
                Option("completed", en ? "Completed" : "已完成", "success"),
                Option("closed", en ? "Closed" : "已关闭", "neutral")
            ],
            ProjectPriorities:
            [
                Option("low", en ? "Low" : "低"),
                Option("normal", en ? "Normal" : "普通"),
                Option("high", en ? "High" : "高"),
                Option("urgent", en ? "Urgent" : "紧急", "danger")
            ]);
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

    // Built-in illustrative assets, not customer uploads. Unknown/custom IDs have no implied example.
    public static string? VisualStylePreviewUrl(string id) => id switch
    {
        "cinematic" or "storybook" or "editorial" or "watercolor" or "animation-3d" or "motion-graphics"
            => $"/style-previews/{id}-v1.jpg",
        _ => null
    };

    private static ConfigOptionDto Style(string id, string label, string color) =>
        new(id, label, PreviewColor: color, PreviewImageUrl: VisualStylePreviewUrl(id));
    private static ConfigOptionDto Option(string id, string label, string? tone = null, string? previewColor = null, bool allowsCustomValue = false) => new(id, label, null, tone, previewColor, allowsCustomValue);
    private static ReferenceCategoryDto Category(string id, string label, string description, string[] accept, long maxBytes, int maxFiles, bool allowsUrl = false, bool required = false) => new(id, label, description, accept, maxBytes, maxFiles, allowsUrl, required);
    private static IReadOnlySet<string> Set(params string[] values) => new HashSet<string>(values, StringComparer.Ordinal);
}
