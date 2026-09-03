using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class CharacterPresetCatalog
{
    // New projects receive these defaults; the one-time legacy upgrade never adds deleted characters.
    public static CharacterInfoDto[] Create(string locale)
    {
        var en = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        return [
            Make("protagonist", en ? "Mara" : "米拉", "young-adult", "female",
                en ? "Leads the story, pursues a clear goal and grows through its central conflict." : "推动主线，追求明确目标，在核心冲突中成长。",
                en ? "Curious, determined and compassionate; learns to balance courage with judgment." : "好奇、坚毅、富有同理心，逐渐学会平衡勇气与判断。",
                en ? "Young adult woman with short dark wavy hair and attentive eyes." : "年轻成年女性，深色短卷发，眼神专注。",
                en ? "Olive field jacket, cream shirt and canvas satchel." : "橄榄绿外套、米白衬衫、帆布挎包。"),
            Make("supporting", en ? "Theo" : "西奥", "adult", "male",
                en ? "Supports the protagonist, adds a complementary viewpoint and helps at key moments." : "协助主角，在关键时刻提供帮助，补充不同视角。",
                en ? "Reliable, resourceful and humorous; willing to challenge a friend's assumptions." : "可靠、机敏、有幽默感，愿意提醒同伴盲点。",
                en ? "Adult man with curly brown hair and an approachable smile." : "成年男性，棕色卷发，笑容亲切。",
                en ? "Blue work shirt and tan vest." : "蓝色衬衫、浅棕马甲。"),
            Make("narrator", en ? "Nora" : "诺拉", "adult", "female",
                en ? "An optional on-screen storyteller who connects scenes and provides context. Voice narration is configured separately." : "可选的出镜讲述者，串联场景、交代背景；是否配旁白在配音步骤单独设置。",
                en ? "Observant, measured and empathetic; explains without overwhelming the story." : "细致、沉稳、富有共情，讲述清晰且留有余地。",
                en ? "Middle-aged woman with dark brown skin, silver-streaked short hair and expressive eyes." : "中年女性，深棕肤色，短发夹有银丝，眼神生动。",
                en ? "Burgundy cardigan and cream blouse; carries a plain book." : "酒红开衫、米白上衣，手持素面书册。"),
            Make("mentor", en ? "Chen Wen" : "陈文", "senior", "male",
                en ? "Offers guidance, experience and perspective while allowing the protagonist to make their own choices." : "提供经验、指引与新视角，让主角自己作出选择。",
                en ? "Patient, perceptive and kind, with a quiet sense of humor." : "耐心、敏锐、温和，带有含蓄的幽默感。",
                en ? "Older East Asian man with salt-and-pepper hair and a short beard." : "年长东亚男性，花白头发与短须，神情温和。",
                en ? "Simple beige linen jacket." : "简洁的米色亚麻外套。"),
            Make("antagonist", en ? "Vera" : "薇拉", "adult", "female",
                en ? "Opposes the protagonist with a clear, believable motive and creates the main obstacles." : "因明确且可信的动机与主角形成对立，制造主要障碍。",
                en ? "Disciplined, strategic and convinced of her own principles; capable of doubt." : "自律、善于谋划、坚信自身原则，也会犹疑。",
                en ? "Adult woman with neatly styled black hair and a composed, stern expression." : "成年女性，黑发整齐，神态冷静严肃。",
                en ? "Charcoal tailored coat with a clean silhouette." : "线条利落的深灰色外套。"),
            Make("child", en ? "Leo" : "里奥", "child", "male",
                en ? "Offers a fresh perspective and reveals the emotional stakes through questions and discovery." : "通过提问与探索提供新鲜视角，呈现故事中的情感牵挂。",
                en ? "Curious, sincere, imaginative and eager to learn." : "好奇、真诚、想象力丰富、乐于学习。",
                en ? "Child about nine years old with curly dark hair and a cheerful expression." : "约九岁的儿童，深色卷发，神情活泼。",
                en ? "Mustard sweater and denim overalls; carries a small notebook." : "芥末黄毛衣、牛仔背带裤，携带小笔记本。"),
            Make("background", en ? "Clara" : "克拉拉", "adult", "female",
                en ? "An optional everyday resident who establishes the setting and supports crowd scenes." : "可选的普通居民，用于交代环境、丰富日常与群像场景。",
                en ? "Natural, friendly and understated; reacts consistently with the scene." : "自然、友善、不抢戏，反应符合场景。",
                en ? "Adult resident with tied-back auburn hair and a relaxed expression." : "成年居民，红棕头发束起，神态放松。",
                en ? "Sage apron over a cream shirt." : "米白衬衫外搭灰绿围裙。")
        ];
    }

    public static CharacterInfoDto UpgradeLegacy(CharacterInfoDto character)
    {
        if (character.PresetId is null || character.RoleTypeId != character.PresetId) return character;
        var legacyNames = character.PresetId switch
        {
            "protagonist" => ("主角", "Protagonist"),
            "supporting" => ("配角", "Supporting character"),
            "narrator" => ("旁白角色", "Narrator character"),
            "mentor" => ("导师", "Mentor"),
            "antagonist" => ("反派", "Antagonist"),
            "child" => ("儿童角色", "Child character"),
            "background" => ("背景角色", "Background character"),
            _ => ("", "")
        };
        var en = character.Name == legacyNames.Item2;
        var preset = Create(en ? "en-US" : "zh-CN").FirstOrDefault(item => item.PresetId == character.PresetId);
        if (preset is null) return character;
        return character with
        {
            Name = character.Name == legacyNames.Item1 || en ? preset.Name : character.Name,
            AgeRangeId = string.IsNullOrWhiteSpace(character.AgeRangeId) ? preset.AgeRangeId : character.AgeRangeId,
            GenderId = string.IsNullOrWhiteSpace(character.GenderId) ? preset.GenderId : character.GenderId
        };
    }

    private static CharacterInfoDto Make(string role, string name, string age, string gender, string story, string personality, string appearance, string clothing)
        => new(Guid.NewGuid().ToString("N"), role, name, story, personality, appearance, age, gender,
            clothing, null, null, [], [], role);
}
