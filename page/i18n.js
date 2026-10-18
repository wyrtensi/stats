// Interface strings. Russian for ru and its neighbours, English for the rest.
export const T = {
  ru: {
    lead: 'Сколько людей заходит на наши сайты. Без cookie и без IP-адресов.',
    summary: 'За последние {days} на наши сайты зашли {people}. Больше всего — на {site}.',
    summaryNone: 'За последние {days} посещений пока нет.',
    peopleOne: 'человек', peopleFew: 'человека', peopleMany: 'человек',
    dayOne: 'день', dayFew: 'дня', dayMany: 'дней',
    botsOne: 'и {n} запрос от роботов поисковиков и ИИ', botsFew: 'и {n} запроса от роботов поисковиков и ИИ', botsMany: 'и {n} запросов от роботов поисковиков и ИИ',
    more: 'Подробнее →', periodLabel: 'Период',
    aboutRusinternet: 'Сертификаты Минцифры', aboutWystore: 'Магазин приложений для Android', aboutWashguide: 'Справочник старых стиральных машин',
    pages: 'Страницы', hintPages: 'какие страницы открывали',
    referrers: 'Откуда пришли', hintReferrers: 'поисковики и сайты, где была ссылка; «напрямую» — набрали адрес или открыли закладку',
    countries: 'Страны', hintCountries: 'по адресу подключения; сам адрес не сохраняется',
    languages: 'Языки', hintLanguages: 'язык, выбранный в браузере',
    browsers: 'Браузеры', systems: 'Системы',
    bots: 'Роботы', hintBots: 'поисковики и ИИ-сервисы, которые читают сайт; людьми не считаются',
    catSearch: 'поиск', catAi: 'ИИ', catOther: 'прочие',
    other: 'другие', unknown: 'не определено', direct: 'напрямую', noData: 'Пока нет данных за этот период.',
    app: 'Приложение Wy Store', latest: 'Последняя версия', latestDownloads: 'Скачиваний версии',
    totalDownloads: 'Скачиваний всего', allTime: 'за всё время, по данным GitHub', releases: 'релизов',
    collectedTitle: 'Что мы собираем', keptTitle: 'Сохраняется для каждого просмотра', notKeptTitle: 'Не сохраняется',
    cPage: 'страница', cTime: 'время', cReferrer: 'откуда пришли', cCountry: 'страна', cLanguage: 'язык браузера', cBrowser: 'браузер', cSystem: 'система',
    cBots: 'для роботов — только имя и число запросов',
    nCookies: 'cookie', nIp: 'IP-адреса', nSize: 'размер экрана',
    summaryOnly: 'Каждый просмотр хранится отдельно, но здесь показана только сводка.',
    counterNote: 'Счётчик — GoatCounter на нашем сервере.', source: 'Исходный код страницы',
    updated: 'Обновлено', stale: 'данные могут быть устаревшими', loadError: 'Не удалось загрузить данные.',
    back: '← Все сайты', theme: 'Тема', lang: 'English'
  },
  en: {
    lead: 'How many people visit our sites. No cookies and no IP addresses.',
    summary: 'In the last {days}, {people} visited our sites. Most went to {site}.',
    summaryNone: 'No visits in the last {days} yet.',
    peopleOne: 'person', peopleFew: 'people', peopleMany: 'people',
    dayOne: 'day', dayFew: 'days', dayMany: 'days',
    botsOne: 'and {n} request from search and AI robots', botsFew: 'and {n} requests from search and AI robots', botsMany: 'and {n} requests from search and AI robots',
    more: 'Details →', periodLabel: 'Period',
    aboutRusinternet: 'Russian root certificates', aboutWystore: 'An Android app store', aboutWashguide: 'A guide to old washing machines',
    pages: 'Pages', hintPages: 'which pages were opened',
    referrers: 'Where people came from', hintReferrers: 'search engines and sites with a link; “direct” means typed or bookmarked',
    countries: 'Countries', hintCountries: 'from the connection address; the address itself is not kept',
    languages: 'Languages', hintLanguages: 'the language set in the browser',
    browsers: 'Browsers', systems: 'Systems',
    bots: 'Robots', hintBots: 'search engines and AI services reading the site; not counted as people',
    catSearch: 'search', catAi: 'AI', catOther: 'other',
    other: 'others', unknown: 'unknown', direct: 'direct', noData: 'No data for this period yet.',
    app: 'Wy Store app', latest: 'Latest version', latestDownloads: 'Downloads of this version',
    totalDownloads: 'Downloads in total', allTime: 'all time, from GitHub', releases: 'releases',
    collectedTitle: 'What we collect', keptTitle: 'Kept for each view', notKeptTitle: 'Not kept',
    cPage: 'page', cTime: 'time', cReferrer: 'where they came from', cCountry: 'country', cLanguage: 'browser language', cBrowser: 'browser', cSystem: 'system',
    cBots: 'for robots, only the name and the number of requests',
    nCookies: 'cookies', nIp: 'IP addresses', nSize: 'screen size',
    summaryOnly: 'Each view is stored separately, but this page shows only the summary.',
    counterNote: 'The counter is GoatCounter on our own server.', source: 'Source code of this page',
    updated: 'Updated', stale: 'the data may be stale', loadError: 'Could not load the data.',
    back: '← All sites', theme: 'Theme', lang: 'Русский'
  }
};

const RU_FAMILY = ['ru', 'uk', 'be', 'kk', 'uz'];

export function pickLang(navLang, saved) {
  if (saved === 'ru' || saved === 'en') return saved;
  const primary = String(navLang || '').toLowerCase().split(/[-_]/)[0];
  return RU_FAMILY.includes(primary) ? 'ru' : 'en';
}

// Word form for a count. Russian: 1, 21, 101 -> one; 2-4, 22-24 -> few;
// 11-14 and the rest -> many. English: 1 -> one, everything else -> many.
export function plural(n, one, few, many, lang = 'ru') {
  const a = Math.abs(n);
  if (lang !== 'ru') return a === 1 ? one : many;
  const d = a % 10, h = a % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}
