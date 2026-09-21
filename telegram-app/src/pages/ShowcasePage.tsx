import { useRef, useState } from "react";
import {
  Accordion,
  Avatar,
  AvatarStack,
  Badge,
  Banner,
  Blockquote,
  Breadcrumbs,
  Button,
  ButtonCell,
  Caption,
  Card,
  Cell,
  Checkbox,
  Chip,
  CircularProgress,
  ColorInput,
  CompactPagination,
  Divider,
  FileInput,
  Headline,
  IconButton,
  IconContainer,
  Image,
  InlineButtons,
  Input,
  LargeTitle,
  Link,
  List,
  Modal,
  Pagination,
  Placeholder,
  Progress,
  Radio,
  Rating,
  Section,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Snackbar,
  Spinner,
  Spoiler,
  Steps,
  Subheadline,
  Switch,
  TabsList,
  Text,
  Textarea,
  Timeline,
  Title,
  Tooltip,
} from "@telegram-apps/telegram-ui";
import { Car, Check, Info, Plus, Search, Star, User } from "lucide-react";

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

/**
 * Витрина UI-кита: все компоненты @telegram-apps/telegram-ui
 * в основных состояниях. Секции пронумерованы.
 */
export function ShowcasePage() {
  const [segment, setSegment] = useState("one");
  const [tab, setTab] = useState("a");
  const [accordionOpen, setAccordionOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [snack, setSnack] = useState(false);
  const [rating, setRating] = useState(4);
  const [slider, setSlider] = useState(40);
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState("r1");
  const [switched, setSwitched] = useState(true);
  const [spoiler, setSpoiler] = useState(false);
  const [page, setPage] = useState(2);
  const tipLightRef = useRef<HTMLElement>(null!);
  const tipDarkRef = useRef<HTMLElement>(null!);

  return (
    <List style={{ background: "var(--tgui--secondary_bg_color)" }}>
      <Section
        header="1. Типографика"
        footer="LargeTitle → Title → Headline → Text → Subheadline → Caption."
      >
        <LargeTitle weight="1">LargeTitle · Заголовок экрана</LargeTitle>
        <Title weight="1">Title · Раздел</Title>
        <Headline weight="1">Headline · Подзаголовок</Headline>
        <Text>Text · основной текст абзаца витрины.</Text>
        <Subheadline level="1" weight="2">
          Subheadline · маршрут Вологда → Череповец
        </Subheadline>
        <Caption level="1" weight="1">
          Caption · мета-строка 450₽ · место 2 · дата · время
        </Caption>
        <Row>
          <Caption weight="1">weight 1</Caption>
          <Caption weight="2">weight 2</Caption>
          <Caption weight="3">weight 3</Caption>
        </Row>
      </Section>

      <Section
        header="2. Кнопки"
        footer="Button: 6 режимов × 3 размера + loading/disabled/stretched."
      >
        <Row>
          {(
            ["filled", "bezeled", "plain", "gray", "outline", "white"] as const
          ).map((mode) => (
            <Button key={mode} mode={mode} size="m">
              {mode}
            </Button>
          ))}
        </Row>
        <Row>
          <Button size="s">size s</Button>
          <Button size="m">size m</Button>
          <Button size="l">size l</Button>
        </Row>
        <Row>
          <Button loading>loading</Button>
          <Button disabled>disabled</Button>
        </Row>
        <Button stretched mode="bezeled">
          stretched на всю ширину
        </Button>
        <Row>
          {(["bezeled", "plain", "gray", "outline"] as const).map((mode) => (
            <IconButton key={mode} mode={mode} aria-label={mode}>
              <Star size={20} />
            </IconButton>
          ))}
          <IconButton size="s" aria-label="s">
            <Plus size={16} />
          </IconButton>
          <IconButton size="l" aria-label="l">
            <Plus size={24} />
          </IconButton>
        </Row>
        <InlineButtons mode="bezeled">
          <Button mode="bezeled" size="s">
            Принять
          </Button>
          <Button mode="bezeled" size="s">
            Отклонить
          </Button>
        </InlineButtons>
      </Section>

      <Section
        header="3. Ячейки"
        footer="Cell: before/after, subtitle, description, multiline, ButtonCell."
      >
        <Cell
          before={
            <Avatar size={48} acronym="АН">
              <Avatar.Badge mode="white" type="number">
                4.9
              </Avatar.Badge>
            </Avatar>
          }
          subtitle="Анна"
          description="450₽ · место 2 · 20 сен · 08:00"
          after={
            <IconButton mode="bezeled" size="s" aria-label="Открыть">
              <Plus size={20} />
            </IconButton>
          }
        >
          Вологда → Череповец
        </Cell>
        <Cell
          type="button"
          multiline
          subtitle="многострочная ячейка"
          description="вторая строка описания видна целиком"
        >
          Multiline Cell
        </Cell>
        <Cell
          before={
            <IconContainer>
              <Car size={22} />
            </IconContainer>
          }
        >
          Cell с иконкой
        </Cell>
        <ButtonCell before={<Plus size={20} />}>
          ButtonCell · Показать все (12)
        </ButtonCell>
      </Section>

      <Section
        header="4. Аватары и бейджи"
        footer="Avatar 40/48/96, Badge: 5 режимов, AvatarStack."
      >
        <Row>
          <Avatar size={40} acronym="АА" />
          <Avatar size={48} acronym="ББ" />
          <Avatar size={96} acronym="ВВ" />
        </Row>
        <Row>
          {(["primary", "critical", "secondary", "gray", "white"] as const).map(
            (mode) => (
              <Badge key={mode} mode={mode} type="number">
                5
              </Badge>
            ),
          )}
        </Row>
        <AvatarStack>
          <Avatar size={40} acronym="АА" />
          <Avatar size={40} acronym="ББ" />
          <Avatar size={40} acronym="ВВ" />
        </AvatarStack>
        <Row>
          <Image size={48} fallbackIcon={<User size={24} />}>
            <Caption>48</Caption>
          </Image>
          <Image size={96} fallbackIcon={<User size={48} />}>
            <Caption>96</Caption>
          </Image>
        </Row>
      </Section>

      <Section
        header="5. Баннеры, карточки, цитаты"
        footer="Banner section/inline, Card, Blockquote text/other, Placeholder, Divider."
      >
        <Banner
          type="section"
          header="Вологда → Череповец"
          description="20 сен · 08:00 · место 2 · 450 ₽"
          before={
            <IconContainer>
              <Car size={28} />
            </IconContainer>
          }
        />
        <Banner
          type="inline"
          header="Inline-баннер"
          description="компактный вариант"
        />
        <Card>
          <Text>Card · произвольный контент карточки</Text>
        </Card>
        <Blockquote type="text">
          Blockquote text · комментарий водителя
        </Blockquote>
        <Blockquote type="other">Blockquote other · отзыв пассажира</Blockquote>
        <Placeholder
          header="Placeholder"
          description="пустое состояние с описанием"
          action={<Button mode="bezeled">Действие</Button>}
        />
        <Divider />
        <Caption>Divider выше · разделитель</Caption>
      </Section>

      <Section
        header="6. Ввод"
        footer="Input (статусы, disabled, before/after), Textarea, Select, ColorInput, FileInput."
      >
        <Input header="Обычный" placeholder="Введите текст" />
        <Input header="Статус error" status="error" defaultValue="неверно" />
        <Input header="Статус focused" status="focused" defaultValue="фокус" />
        <Input header="Disabled" disabled defaultValue="недоступно" />
        <Input
          header="С иконками"
          before={<Search size={20} />}
          after={<Info size={20} />}
          placeholder="Поиск"
        />
        <Textarea header="Textarea" placeholder="Многострочный текст" />
        <Select header="Select">
          {" "}
          <option value="1">Вариант 1</option>
          <option value="2">Вариант 2</option>
        </Select>
        {/* PinInput исключён: его оверлей перекрывает страницу витрины. */}
        <ColorInput header="ColorInput" />
        <FileInput label="FileInput" />
      </Section>

      <Section
        header="7. Выбор"
        footer="Checkbox (вкл/выкл/indeterminate/disabled), Radio, Switch, Slider, Rating, Chip."
      >
        <Row>
          <Checkbox
            checked={checked}
            onChange={() => setChecked((v) => !v)}
            aria-label="Checkbox включён"
          />
          <Text>Checkbox включён</Text>
        </Row>
        <Row>
          <Checkbox checked={false} aria-label="Checkbox выключен" />
          <Text>Checkbox выключен</Text>
        </Row>
        <Row>
          <Checkbox indeterminate aria-label="Checkbox indeterminate" />
          <Text>Checkbox indeterminate</Text>
        </Row>
        <Row>
          <Checkbox disabled aria-label="Checkbox disabled" />
          <Text>Checkbox disabled</Text>
        </Row>
        <Row>
          <Radio
            name="show-radio"
            value="r1"
            checked={radio === "r1"}
            onChange={() => setRadio("r1")}
            aria-label="Radio 1"
          />
          <Text>Radio 1</Text>
          <Radio
            name="show-radio"
            value="r2"
            checked={radio === "r2"}
            onChange={() => setRadio("r2")}
            aria-label="Radio 2"
          />
          <Text>Radio 2</Text>
        </Row>
        <Row>
          <Switch
            checked={switched}
            onChange={() => setSwitched((v) => !v)}
            aria-label="Switch"
          />
          <Text>Switch</Text>
        </Row>
        <Slider
          min={0}
          max={100}
          value={slider}
          onChange={setSlider}
          getAriaLabel={() => "Слайдер"}
        />
        <Caption>Slider: {slider}</Caption>
        <Rating max={5} value={rating} onChange={setRating} />
        <Caption>Rating: {rating}/5</Caption>
        <Row>
          {(["elevated", "mono", "outline"] as const).map((mode) => (
            <Chip key={mode} mode={mode}>
              {mode}
            </Chip>
          ))}
        </Row>
      </Section>

      <Section
        header="8. Навигация"
        footer="SegmentedControl, TabsList, Pagination, CompactPagination, Breadcrumbs, Link."
      >
        <SegmentedControl>
          {[
            { value: "one", label: "Один" },
            { value: "two", label: "Два" },
          ].map((o) => (
            <SegmentedControl.Item
              key={o.value}
              selected={segment === o.value}
              onClick={() => setSegment(o.value)}
            >
              {o.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
        <TabsList>
          {[
            { value: "a", label: "Вкладка A" },
            { value: "b", label: "Вкладка B" },
          ].map((o) => (
            <TabsList.Item
              key={o.value}
              selected={tab === o.value}
              onClick={() => setTab(o.value)}
            >
              {o.label}
            </TabsList.Item>
          ))}
        </TabsList>
        <Pagination
          count={5}
          page={page}
          siblingCount={1}
          boundaryCount={1}
          onChange={(_e, p) => setPage(p)}
        />
        <CompactPagination mode="default">
          <CompactPagination.Item selected={false}>1</CompactPagination.Item>
          <CompactPagination.Item selected>2</CompactPagination.Item>
          <CompactPagination.Item selected={false}>3</CompactPagination.Item>
        </CompactPagination>
        <Breadcrumbs divider="dot">
          <Breadcrumbs.Item>★ 4.9</Breadcrumbs.Item>
          <Breadcrumbs.Item>12 поездок</Breadcrumbs.Item>
        </Breadcrumbs>
        <Breadcrumbs divider="slash">
          <Breadcrumbs.Item>раз</Breadcrumbs.Item>
          <Breadcrumbs.Item>два</Breadcrumbs.Item>
        </Breadcrumbs>
        <Breadcrumbs divider="chevron">
          <Breadcrumbs.Item>раз</Breadcrumbs.Item>
          <Breadcrumbs.Item>два</Breadcrumbs.Item>
        </Breadcrumbs>
        <Link href="/">Link · внутренняя ссылка</Link>
      </Section>

      <Section
        header="9. Прогресс и состояния"
        footer="Spinner, Progress, CircularProgress, Skeleton, Spoiler, Snackbar."
      >
        <Row>
          <Spinner size="s" />
          <Spinner size="m" />
          <Spinner size="l" />
        </Row>
        <Progress value={30} />
        <Progress value={75} />
        <Row>
          <CircularProgress size="small" progress={25} />
          <CircularProgress size="medium" progress={60} />
          <CircularProgress size="large" progress={90} />
        </Row>
        <Skeleton visible withoutAnimation={false}>
          <Text>Skeleton · видимая заглушка с анимацией</Text>
        </Skeleton>
        <Spoiler visible={spoiler}>
          <Text>Spoiler · скрытый текст отзыва</Text>
        </Spoiler>
        <Button mode="bezeled" onClick={() => setSpoiler((v) => !v)}>
          {spoiler ? "Скрыть спойлер" : "Показать спойлер"}
        </Button>
        <Button mode="bezeled" onClick={() => setSnack(true)}>
          Показать Snackbar
        </Button>
        {snack && (
          <Snackbar
            before={<Check size={20} />}
            onClose={() => setSnack(false)}
            duration={4000}
          >
            Snackbar · заявка принята
          </Snackbar>
        )}
      </Section>

      <Section header="10. Оверлеи" footer="Modal, Tooltip, Accordion.">
        <Button mode="bezeled" onClick={() => setModalOpen(true)}>
          Открыть Modal
        </Button>
        <Modal
          open={modalOpen}
          onOpenChange={(next) => {
            if (!next) setModalOpen(false);
          }}
          header={<Modal.Header>Modal · заголовок</Modal.Header>}
        >
          <Text>Контент модального окна витрины.</Text>
        </Modal>
        <span ref={tipLightRef}>
          <Caption>Цель · light</Caption>
        </span>
        <Tooltip mode="light" targetRef={tipLightRef} title="Tooltip light">
          <Caption>подсказка light</Caption>
        </Tooltip>
        <span ref={tipDarkRef}>
          <Caption>Цель · dark</Caption>
        </span>
        <Tooltip mode="dark" targetRef={tipDarkRef} title="Tooltip dark">
          <Caption>подсказка dark</Caption>
        </Tooltip>
        <Accordion expanded={accordionOpen} onChange={setAccordionOpen}>
          <Accordion.Summary>Accordion · отзывы (2)</Accordion.Summary>
          <Accordion.Content>
            <Text>Содержимое аккордеона витрины.</Text>
          </Accordion.Content>
        </Accordion>
      </Section>

      <Section
        header="11. Шкала и время"
        footer="Timeline (vertical/horizontal), Steps."
      >
        <Timeline active={1}>
          <Timeline.Item header="Заявка">пассажир откликнулся</Timeline.Item>
          <Timeline.Item header="Подтверждение">водитель одобрил</Timeline.Item>
          <Timeline.Item header="Поездка">20 сен · 08:00</Timeline.Item>
        </Timeline>
        <Timeline horizontal active={0}>
          <Timeline.Item header="Шаг 1">старт</Timeline.Item>
          <Timeline.Item header="Шаг 2">финиш</Timeline.Item>
        </Timeline>
        <Steps count={4} progress={2} />
        <Caption>Steps · 2 из 4</Caption>
      </Section>

      <Section
        header="12. Служебное"
        footer="Tabbar — каркас приложения: живой внизу экрана, демо здесь не рендерим (TGUI Tabbar всегда fixed и лёг бы вторым слоем)."
      >
        <Caption>Остальное — утилиты (haptic, openLink, shareURL).</Caption>
      </Section>
    </List>
  );
}
