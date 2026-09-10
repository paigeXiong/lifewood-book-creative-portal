import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {ExpandableText} from "./ExpandableText";
import {i18n} from "@lifewood/i18n";
import "./i18n";

it.each(["zh-CN","en-US"])("keeps unreviewed text escaped in %s", async locale => {
 await i18n.changeLanguage(locale);
 const payload='<script>window.__injected=1</script><img src=x onerror="alert(1)"><iframe srcdoc="bad"></iframe><svg onload="alert(1)"></svg>';
 const html=renderToStaticMarkup(<ExpandableText text={payload}/>);
 expect(html).not.toMatch(/<(script|img|iframe|svg)\b/);
 expect(html).toContain('&lt;script&gt;');
 expect(html).toContain('onerror=&quot;alert(1)&quot;');
});
