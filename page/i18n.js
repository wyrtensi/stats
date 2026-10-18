// Interface strings. Russian for ru and its neighbours, English for the rest.
export const T = {
  ru: {
    title: 'Статистика', lead: 'Сколько людей заходит на наши сайты. Без cookie и без IP-адресов — только то, что видно ниже.',
    days: 'дн.', visits: 'визитов', pages: 'Страницы', referrers: 'Откуда пришли', countries: 'Страны',
    browsers: 'Браузеры', systems: 'Системы', other: 'остальное', unknown: 'неизвестно', noData: 'Пока нет данных за этот период.',
    app: 'Приложение Wy Store', latest: 'Последняя версия', latestDownloads: 'Скачиваний версии',
    totalDownloads: 'Скачиваний всего', allTime: 'за всё время, по данным GitHub', releases: 'релизов',
    collectedTitle: 'Что мы собираем', keptTitle: 'Сохраняется', notKeptTitle: 'Не сохраняется',
    cPage: 'страница', cReferrer: 'источник перехода', cCountry: 'страна', cBrowser: 'браузер', cSystem: 'система',
    nCookies: 'cookie', nIp: 'IP-адреса', nSize: 'размер экрана', nLanguage: 'язык', nVisits: 'отдельные визиты',
    counterNote: 'Счётчик — GoatCounter на нашем сервере.', source: 'Исходный код страницы',
    people: 'людей', botRequests: 'запросов ботов', bots: 'Боты', catSearch: 'поиск', catAi: 'ИИ', catOther: 'прочие', cBots: 'для ботов — только имя и число запросов',
    updated: 'Обновлено', stale: 'данные могут быть устаревшими', back: '← Все сайты', theme: 'Тема', lang: 'English'
  },
  en: {
    title: 'Stats', lead: 'How many people visit our sites. No cookies and no IP addresses — only what you see below.',
    days: 'days', visits: 'visits', pages: 'Pages', referrers: 'Referrers', countries: 'Countries',
    browsers: 'Browsers', systems: 'Systems', other: 'other', unknown: 'unknown', noData: 'No data for this period yet.',
    app: 'Wy Store app', latest: 'Latest version', latestDownloads: 'Downloads of this version',
    totalDownloads: 'Downloads in total', allTime: 'all time, from GitHub', releases: 'releases',
    collectedTitle: 'What we collect', keptTitle: 'Kept', notKeptTitle: 'Not kept',
    cPage: 'page', cReferrer: 'referrer', cCountry: 'country', cBrowser: 'browser', cSystem: 'system',
    nCookies: 'cookies', nIp: 'IP addresses', nSize: 'screen size', nLanguage: 'language', nVisits: 'individual visits',
    counterNote: 'The counter is GoatCounter on our own server.', source: 'Source code of this page',
    people: 'people', botRequests: 'bot requests', bots: 'Bots', catSearch: 'search', catAi: 'AI', catOther: 'other', cBots: 'for bots, only the name and the number of requests',
    updated: 'Updated', stale: 'the data may be stale', back: '← All sites', theme: 'Theme', lang: 'Русский'
  }
};

const RU_FAMILY = ['ru', 'uk', 'be', 'kk', 'uz'];

export function pickLang(navLang, saved) {
  if (saved === 'ru' || saved === 'en') return saved;
  return RU_FAMILY.includes(String(navLang || '').slice(0, 2).toLowerCase()) ? 'ru' : 'en';
}
