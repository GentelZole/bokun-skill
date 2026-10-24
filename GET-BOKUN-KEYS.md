# كيف تجيب مفاتيح بوكي (Bókun API Keys)

هذا الملف مكتوب لك أنت — صاحب الحساب — ولأيجنتك. الأيجنت ما يقدر يعمل مفاتيح بدالك، لازم أنت تعملها من لوحة بوكي خلال دقيقتين، وبعدها تعطيه المفاتيح.

---

## ما هو المطلوب بالضبط

مفتاح API في بوكي = **مفتاحان**:
- `Access Key` — المفتاح العلني
- `Secret Key` — المفتاح السري (يُعرض **مرة واحدة فقط** عند الإنشاء)

الأيجنت يحتاج الاثنين. أعطه إياهما في متغيرات بيئة:

```bash
BOKUN_ACCESS_KEY=...
BOKUN_SECRET_KEY=...
```

---

## الخطوات (من لوحة بوكي)

**قبل أي شيء — لو ما عندك Booking Channel:**
1. افتح `Settings` → `Sales Settings` → `Booking Channels`
2. أنشئ قناة جديدة (مثلاً `Website`) واضبط عملة الدفع (SAR مثلاً)
3. هذا إلزامي: كل استدعاء API لازم يكون داخل قناة حجز

**بعدها أنشئ المفتاح:**
1. افتح الرابط المباشر: **https://extranet.bokun.io/app/settings/connections/api**
   (أو `Settings` → `Connections` → `API Keys`)
2. اضغط **Add** في أعلى يمين الصفحة
3. املأ بطاقة `Create API Key`:
   - **Title:** اسم داخلي مثل `Agent - Website`
   - **Services:** هل المفتاح يقدر يحجز بدون بوابة دفع داخل بوكي
   - **User role:** صلاحيات المفتاح (يفضّل أقل صلاحية تكفي — لا تعطه Admin)
   - **Booking channel:** القناة التي أنشأتها فوق
4. اضغط حفظ → **انسخ الـ Access Key والـ Secret Key فوراً**
5. الـ Secret Key **ما يظهر مرة ثانية**. لو ضاع، أنشئ مفتاحاً جديداً.

**للحساب التجريبي (Demo):** https://extranet.bokuntest.com/app/signup — نفس الخطوات، وأمان للتجارب.

---

## تحذيرات يجب أن تعرفها

- **مفاتيح بوكي تعطي وصولاً لكل منتجاتك وبياناتك.** لا تشاركها مع أي شخص خارج شركتك غير مطوّرك.
- **بوكي تخصم 1.5% رسم حجز** على أي حجز يتم عبر API.
- المفتاح مربوط بالقناة: لو ألغيت القناة يتعطل المفتاح.

---

## نص جاهز يعطيه الأيجنت لك

> لتفعيل الاتصال ببوكي، أحتاج منك مفتاحين. افتح الرابط التالي:
> https://extranet.bokun.io/app/settings/connections/api
> اضغط **Add**، وسمِّ المفتاح `Agent - Website`، واختر قناة الحجز، ثم انسخ
> **Access Key** و **Secret Key** وأرسلهما لي. لو ما عندك قناة حجز:
> `Settings` → `Sales Settings` → `Booking Channels`.

---

## ما يفعله الأيجنت بعد استلام المفاتيح

1. يضع المفتاحين في ملف `.env` (لا يرفعهما إلى Git أبداً — تأكد أن `.env` داخل `.gitignore`)
2. يتحقق من الاتصال باستدعاء قراءة واحد، مثل:
   ```bash
   # التوقيع: base64(HMAC-SHA1(secret, date + accessKey + "GET" + path))
   curl -s "https://api.bokun.io/restapi/v2.0/booking/-1/audit-records" \
     -H "X-Bokun-Date: $DATE" \
     -H "X-Bokun-AccessKey: $BOKUN_ACCESS_KEY" \
     -H "X-Bokun-Signature: $SIGNATURE"
   ```
   ردّ بصلاحية/وجود المسار = المفاتيح سليمة. لو ردّ 401 فالمفتاح أو التوقيع خطأ.
3. يقرأ `SKILL.md` في كل مجلد قبل أي كتابة على الحساب — خاصة `bokun-live-account-operations/` لأنها تعمل على حساب حقيقي.

---

## مرجع

- إنشاء المفاتيح: https://docs.bokun.io/en/articles/327-using-bokun-s-api-and-web-services
- إعداد المنصة للـ API: https://bokun.dev/booking-api-rest/vU6sCfxwYdJWd1QAcLt12i/configuring-the-platform-for-api-usage-and-authentication/sFiGRpo4detkmrZPcWtQPj
- توثيق الـ API: https://bokun.dev/booking-api-restful/vU6sCfxwYdJWd1QAcLt12i