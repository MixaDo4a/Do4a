from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Flowable
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)

pdfmetrics.registerFont(TTFont("Segoe", r"C:\Windows\Fonts\segoeui.ttf"))
pdfmetrics.registerFont(TTFont("SegoeBold", r"C:\Windows\Fonts\segoeuib.ttf"))

RED = colors.HexColor("#e32636")
BLACK = colors.HexColor("#0b0b0c")
PANEL = colors.HexColor("#171416")
LINE = colors.HexColor("#5d3639")
MUTED = colors.HexColor("#6d6360")
CREAM = colors.HexColor("#f6f1ea")

roles = {
    "manager": {
        "label": "Менеджер",
        "summary": "Работа в своей смене, выполнение распорядка, задач и закрытие кассы.",
        "routes": ["/", "/shifts", "/routine", "/tasks", "/payroll", "/notifications", "/help"],
        "sections": [
            ("Смена", ["Откройте текущую смену на главной странице.", "Проверьте магазин, дату и статус смены перед началом работы.", "При завершении заполните пересчёт кассы и закройте смену."]),
            ("Распорядок дня", ["Откройте утренний или вечерний распорядок.", "Отмечайте пункты по мере выполнения.", "Если действие не выполнено, укажите причину; при ошибке сохранения повторите после обновления страницы и сообщите управляющему."]),
            ("Задачи", ["В списке отображаются задачи, назначенные вам, и задачи доступных магазинов.", "В каждой задаче видны магазин и ответственный сотрудник.", "После выполнения откройте задачу и отметьте её завершённой."]),
            ("Зарплата", ["В разделе «ЗП» выберите месяц.", "Откройте расчётный лист, чтобы увидеть начисления и связанные смены."]),
        ],
    },
    "auditor": {
        "label": "Проверяющий",
        "summary": "Проведение чек-листов, фиксация нарушений и просмотр закупок и акций.",
        "routes": ["/", "/checklists", "/checklists/new", "/procurement", "/tasks", "/notifications", "/help"],
        "sections": [
            ("Чек-лист", ["Откройте архив проверок или выберите «Провести чек-лист».", "Выберите магазин и заполните каждый пункт.", "Добавьте комментарий и фотографию к пункту, если это необходимо.", "После сохранения результат появится в архиве."]),
            ("Закупки и акции", ["В «Закуп/Акции» просматривайте действующие акции и заказы по доступным магазинам.", "Проверяйте статус, сроки и комментарии по проблемным заказам."]),
            ("Задачи и уведомления", ["Открывайте задачи из списка и проверяйте магазин, срок и ответственного.", "Связанное уведомление открывает нужный раздел приложения."]),
        ],
    },
    "store_manager": {
        "label": "Управляющий",
        "summary": "Управление магазинами, сотрудниками, графиками, задачами, сменами и контролем работы.",
        "routes": ["/", "/admin", "/admin/employees", "/admin/stores", "/admin/schedule", "/admin/routine", "/admin/closed-shifts", "/tasks", "/tasks/archive", "/finances", "/notifications", "/help"],
        "sections": [
            ("Сотрудники и роли", ["Откройте «Упр.» и раздел сотрудников.", "Сотруднику можно назначить несколько ролей.", "Проверьте привязанные магазины и сохраните изменения.", "На главной сотрудник выбирает активную роль в первой плашке."]),
            ("Магазины и доступ", ["Создайте или отредактируйте магазин.", "Доступ к магазину определяет, какие смены, задачи, уведомления и отчёты видит сотрудник.", "Проверяйте доступ после изменения привязок."]),
            ("График", ["Выберите магазин, месяц и дату.", "Назначьте сотрудников на смены и сохраните график.", "На главной ближайшие смены сгруппированы по магазину; управляющий видит дополнительные строки сотрудников."]),
            ("Задачи и архив", ["При создании задачи первым вариантом исполнителя является «Не выбрано».", "Такая задача создаётся одна на магазин и отображается всем менеджерам с доступом к нему.", "Если выбран конкретный ответственный, задача всё равно видна менеджерам магазина, а в карточке указан ответственный.", "В архиве управляющий открывает все задачи доступных магазинов, а не только свои."]),
            ("Контроль", ["Используйте архив смен, распорядок, чек-листы и финансы для проверки работы магазинов."]),
        ],
    },
    "buyer": {
        "label": "Закупщик",
        "summary": "Создание заказов, работа с поставщиками и контроль статусов и акций.",
        "routes": ["/", "/procurement", "/tasks", "/notifications", "/help"],
        "sections": [
            ("Новый заказ", ["Выберите магазин.", "Укажите поставщика, товар, счёт и при необходимости приложите файл.", "Нажмите «Создать заказ» после проверки данных."]),
            ("Статусы заказов", ["В карточке заказа выберите актуальный статус.", "Для проблемного заказа добавьте комментарий.", "Прикреплённые счета и фотографии отображаются в карточке заказа."]),
            ("Акции", ["Выберите магазины, укажите поставщика, товар, условия и период.", "Сохраните акцию и проверьте её в списке акций поставщиков."]),
        ],
    },
    "warehouse_manager": {
        "label": "Кладовщик",
        "summary": "Контроль складских задач, заказов и доступных магазинов.",
        "routes": ["/", "/procurement", "/tasks", "/tasks/archive", "/admin", "/notifications", "/help"],
        "sections": [
            ("Задачи склада", ["Открывайте поручения из главной страницы или раздела задач.", "Проверяйте магазин, описание, срок и ответственного.", "После выполнения отметьте задачу завершённой."]),
            ("Закупки", ["Контролируйте заказы по доступным магазинам.", "Обновляйте статус и добавляйте комментарий при проблеме."]),
            ("Управление", ["В административном разделе доступны только функции, разрешённые активной ролью и привязками магазинов."]),
        ],
    },
    "warehouse_assistant": {
        "label": "Помощник кладовщика",
        "summary": "Выполнение складских задач и работа с уведомлениями.",
        "routes": ["/", "/tasks", "/notifications", "/help"],
        "sections": [
            ("Задачи", ["Откройте задачу из ближайших задач или нижнего меню.", "Перед началом проверьте магазин, описание и срок.", "После выполнения нажмите кнопку завершения."]),
            ("Уведомления", ["Откройте уведомление, чтобы перейти к связанной задаче или событию.", "Отметьте прочитанные уведомления, чтобы очистить список новых."]),
        ],
    },
    "super_admin": {
        "label": "Супер-админ",
        "summary": "Полное управление пользователями, ролями, магазинами, графиками, финансами и проверками.",
        "routes": ["Все доступные разделы приложения"],
        "sections": [
            ("Сотрудники и роли", ["Создавайте и редактируйте сотрудников.", "Назначайте одну или несколько ролей.", "Проверяйте магазины, к которым сотрудник имеет доступ.", "После изменения роли сотрудник выбирает активный интерфейс в верхней плашке."]),
            ("Магазины и графики", ["Создавайте магазины и указывайте их параметры, включая часовой пояс, если он включён в текущей конфигурации.", "Настраивайте доступ сотрудников и расписание смен."]),
            ("Задачи, смены и финансы", ["Контролируйте текущие и архивные задачи всех доступных магазинов.", "Проверяйте закрытые смены, пересчёты, начисления и корректировки."]),
            ("Проверки", ["Создавайте чек-листы, просматривайте результаты, комментарии и вложения."]),
        ],
    },
    "developer": {
        "label": "Разработчик",
        "summary": "Проверка всех интерфейсов и сценариев с возможностью переключения между ролями.",
        "routes": ["Все разделы приложения"],
        "sections": [
            ("Переключение роли", ["На главной нажмите активную роль в первой плашке.", "Выберите роль из списка.", "После выбора интерфейс и доступные разделы загружаются в контексте этой роли.", "Перед проверкой сценария убедитесь, какая роль активна."]),
            ("Проверка данных", ["Проверяйте задачи, уведомления, смены, распорядки, зарплату, закупки, чек-листы и административные разделы.", "Для повторного обучения нажмите кнопку с иконкой справки."]),
            ("Безопасность проверки", ["Не меняйте реальные данные без проверки магазина, роли и цели операции.", "После теста проверьте уведомления и связанные записи."]),
        ],
    },
}

common = [
    ("Вход и выход", ["Откройте страницу входа и укажите логин и пароль.", "Кнопка «Выйти» находится в первой плашке главной страницы.", "После выхода вернитесь на страницу входа и не оставляйте сессию открытой на общем устройстве."]),
    ("Главная страница", ["Первая плашка показывает сотрудника, активную роль, кнопку выхода и уведомления.", "Карточки ниже показывают смены, распорядок, задачи и график.", "Нижнее меню закреплено у нижнего края экрана; свайпы влево и вправо между вкладками отключены."]),
    ("Магазины, доступ и видимость", ["Доступ к магазину влияет на список задач, смен, графиков, уведомлений и отчётов.", "Задача, поставленная на магазин без конкретного исполнителя, создаётся одной записью и видна менеджерам с доступом к магазину.", "Задача с конкретным ответственным также отображается менеджерам доступного магазина; ответственный указан в карточке."]),
    ("Уведомления и даты", ["Уведомления открывают связанные задачи, смены или распорядки.", "Время и даты должны интерпретироваться в часовом поясе магазина, если он задан в настройках магазина.", "Если уведомление не пришло, проверьте разрешение браузера, подписку на push и наличие записи в разделе уведомлений."]),
    ("Обучение и инструкция", ["При первом входе режим обучения показывает подсказки по интерфейсу активной роли.", "Кнопка справки запускает обучение повторно.", "Полная инструкция доступна по ссылке «Инструкция» внутри подсказки и на странице /help."]),
]

class ScreenMap(Flowable):
    def __init__(self, label):
        super().__init__()
        self.label = label
        self.width = 170 * mm
        self.height = 48 * mm
    def draw(self):
        c = self.canv
        c.setFillColor(BLACK); c.roundRect(0, 0, self.width, self.height, 5*mm, fill=1, stroke=0)
        c.setStrokeColor(RED); c.setLineWidth(1); c.roundRect(8*mm, 6*mm, self.width-16*mm, self.height-12*mm, 4*mm, fill=0, stroke=1)
        c.setFillColor(CREAM); c.setFont("SegoeBold", 10); c.drawString(14*mm, self.height-16*mm, self.label)
        boxes = [("Сотрудник / роль", 14, 22, 42, 10), ("Смена", 62, 22, 30, 10), ("Задачи", 98, 22, 28, 10), ("График", 132, 22, 24, 10)]
        for name, x, y, w, h in boxes:
            c.setFillColor(PANEL); c.setStrokeColor(LINE); c.roundRect(x*mm, y*mm, w*mm, h*mm, 2*mm, fill=1, stroke=1)
            c.setFillColor(CREAM); c.setFont("Segoe", 6.5); c.drawCentredString((x+w/2)*mm, (y+h/2-1)*mm, name)
        c.setFillColor(RED); c.roundRect(14*mm, 10*mm, self.width/mm-28, 5*mm, 2*mm, fill=1, stroke=0)
        c.setFillColor(CREAM); c.setFont("Segoe", 6); c.drawCentredString(self.width/2, 11.7*mm, "Нижнее меню: Главная · Задачи · Финансы · Уведомления · Управление")

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED); canvas.setFont("Segoe", 8)
    canvas.drawString(18*mm, 10*mm, "Do4a Staff Only · Инструкция пользователя")
    canvas.drawRightString(192*mm, 10*mm, f"Страница {doc.page}")
    canvas.restoreState()

def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=base["Title"], fontName="SegoeBold", fontSize=27, leading=32, textColor=BLACK, spaceAfter=8),
        "subtitle": ParagraphStyle("subtitle", parent=base["Normal"], fontName="Segoe", fontSize=12, leading=17, textColor=RED, spaceAfter=12),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="SegoeBold", fontSize=18, leading=22, textColor=RED, spaceBefore=10, spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="SegoeBold", fontSize=13, leading=17, textColor=BLACK, spaceBefore=8, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName="Segoe", fontSize=10, leading=15, textColor=colors.HexColor("#272124"), spaceAfter=5),
        "small": ParagraphStyle("small", parent=base["BodyText"], fontName="Segoe", fontSize=8.5, leading=12, textColor=colors.HexColor("#4c4340")),
        "white": ParagraphStyle("white", parent=base["BodyText"], fontName="Segoe", fontSize=10, leading=15, textColor=BLACK),
        "bullet": ParagraphStyle("bullet", parent=base["BodyText"], fontName="Segoe", fontSize=10, leading=15, leftIndent=12, firstLineIndent=-8, textColor=colors.HexColor("#272124"), spaceAfter=3),
    }

def build(role, data):
    path = OUT / f"Do4a_Staff_Only_{role}.pdf"
    st = styles()
    doc = BaseDocTemplate(str(path), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=17*mm, bottomMargin=17*mm, title=f"Do4a Staff Only - {data['label']}", author="Do4a Staff Only")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="main", frames=frame, onPage=footer)])
    story = []
    story += [Spacer(1, 20*mm), Paragraph("Do4a Staff Only", st["title"]), Paragraph(f"Инструкция для роли: <b>{data['label']}</b>", st["subtitle"]), Paragraph(data["summary"], st["white"]), Spacer(1, 8*mm)]
    overview = Table([[Paragraph("Назначение роли", st["small"]), Paragraph(data["summary"], st["small"])], [Paragraph("Доступные разделы", st["small"]), Paragraph(" · ".join(data["routes"]), st["small"])]], colWidths=[38*mm, 128*mm])
    overview.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#f4ece7")), ("BOX", (0,0), (-1,-1), 0.6, LINE), ("INNERGRID", (0,0), (-1,-1), 0.3, colors.HexColor("#d5c4bd")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7)]))
    story.append(overview); story.append(Spacer(1, 8*mm)); story.append(ScreenMap("Карта интерфейса")); story.append(Paragraph("Схема показывает основные зоны приложения. Набор кнопок и данных меняется по активной роли, доступным магазинам и текущему состоянию смены.", st["small"])); story.append(PageBreak())
    story.append(Paragraph("1. Общая логика приложения", st["h1"]))
    for title, items in common:
        story.append(Paragraph(title, st["h2"]))
        for item in items: story.append(Paragraph("• " + item, st["bullet"]))
    story.append(PageBreak())
    story.append(Paragraph(f"2. Работа в интерфейсе: {data['label']}", st["h1"]))
    for title, items in data["sections"]:
        story.append(Paragraph(title, st["h2"]))
        for item in items: story.append(Paragraph("• " + item, st["bullet"]))
    story.append(Spacer(1, 5*mm))
    story.append(Paragraph("3. Полезные настройки и правила", st["h1"]))
    settings = [
        "Активная роль: если у сотрудника несколько ролей, переключение выполняется в первой плашке на главной странице.",
        "Магазин: доступы к магазинам определяют видимые задачи, смены, графики и отчёты.",
        "Часовой пояс: даты и время должны отображаться с учётом часового пояса магазина, к которому относится событие.",
        "Push-уведомления: разрешение браузера и подписка должны быть активны; список уведомлений внутри приложения остаётся источником проверки.",
        "Обучение: кнопку справки можно нажать в любой момент, чтобы повторить подсказки.",
        "Мобильный режим: нижнее меню закреплено у нижнего края, горизонтальные свайпы для перехода между разделами отключены.",
    ]
    for item in settings: story.append(Paragraph("• " + item, st["bullet"]))
    story.append(PageBreak())
    story.append(Paragraph("4. Если что-то не работает", st["h1"]))
    problems = [
        ("Не вижу задачу", "Проверьте активную роль, доступ к магазину и фильтры. Для задачи магазина без ответственного должна существовать одна карточка, доступная менеджерам магазина."),
        ("Не пришло уведомление", "Откройте раздел уведомлений, проверьте разрешение push в браузере и обновите страницу. Если запись есть в приложении, проблема относится к доставке push, а не к созданию события."),
        ("Не сохраняется распорядок", "Проверьте интернет, обновите страницу и повторите отметку. Сохранённые пункты должны изменить счётчик выполненных пунктов."),
        ("Неверное время", "Проверьте часовой пояс магазина и не сравнивайте время события с часовым поясом устройства без учёта настроек магазина."),
        ("Раздел недоступен", "Вернитесь на главную, проверьте активную роль и привязанные магазины. Доступ может быть ограничен ролью или правами пользователя."),
    ]
    tdata = [[Paragraph("Ситуация", st["small"]), Paragraph("Что проверить", st["small"])]] + [[Paragraph(a, st["small"]), Paragraph(b, st["small"])] for a,b in problems]
    tab = Table(tdata, colWidths=[42*mm, 124*mm], repeatRows=1)
    tab.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), RED), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("BACKGROUND", (0,1), (-1,-1), colors.HexColor("#f4ece7")), ("GRID", (0,0), (-1,-1), 0.4, LINE), ("VALIGN", (0,0), (-1,-1), "TOP"), ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7), ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    story.append(tab); story.append(Spacer(1, 8*mm)); story.append(Paragraph("Версия инструкции подготовлена по текущей структуре приложения Do4a Staff Only. Фактический набор разделов может быть уже, если для аккаунта не назначены соответствующие права или магазины.", st["small"]))
    doc.build(story)
    return path

if __name__ == "__main__":
    for role, data in roles.items():
        print(build(role, data))
