import {
  Responsive,
  WidthProvider,
  type LayoutItem,
  type ResponsiveLayouts,
} from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

export const ResponsiveDashboardGrid = WidthProvider(Responsive)
export type DashboardLayouts = ResponsiveLayouts<string>

export type DashboardWidgetId =
  | 'metric-total'
  | 'metric-open'
  | 'metric-progress'
  | 'metric-pending'
  | 'metric-critical'
  | 'trends'
  | 'status'
  | 'queue'
  | 'notes'

export const dashboardWidgetOrder: DashboardWidgetId[] = [
  'metric-total',
  'metric-open',
  'metric-progress',
  'metric-pending',
  'metric-critical',
  'trends',
  'status',
  'queue',
  'notes',
]

export const defaultDashboardLayouts: DashboardLayouts = {
  lg: [
    { i: 'metric-total', x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-open', x: 2, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-progress', x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-pending', x: 6, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-critical', x: 8, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'trends', x: 0, y: 2, w: 6, h: 7, minW: 4, minH: 5, static: false },
    { i: 'status', x: 6, y: 2, w: 4, h: 7, minW: 3, minH: 5, static: false },
    { i: 'queue', x: 0, y: 9, w: 6, h: 9, minW: 4, minH: 6, static: false },
    { i: 'notes', x: 6, y: 9, w: 4, h: 9, minW: 3, minH: 5, static: false },
  ],
  md: [
    { i: 'metric-total', x: 0, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-open', x: 2, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-progress', x: 4, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-pending', x: 6, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'metric-critical', x: 8, y: 0, w: 2, h: 2, minW: 2, minH: 2, static: false },
    { i: 'trends', x: 0, y: 2, w: 6, h: 7, minW: 4, minH: 5, static: false },
    { i: 'status', x: 6, y: 2, w: 4, h: 7, minW: 3, minH: 5, static: false },
    { i: 'queue', x: 0, y: 9, w: 6, h: 9, minW: 4, minH: 6, static: false },
    { i: 'notes', x: 6, y: 9, w: 4, h: 9, minW: 3, minH: 5, static: false },
  ],
  sm: [
    { i: 'metric-total', x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-open', x: 1, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-progress', x: 2, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-pending', x: 3, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-critical', x: 4, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'trends', x: 0, y: 2, w: 5, h: 7, minW: 3, minH: 5, static: false },
    { i: 'status', x: 0, y: 9, w: 5, h: 5, minW: 3, minH: 5, static: false },
    { i: 'queue', x: 0, y: 14, w: 5, h: 8, minW: 3, minH: 6, static: false },
    { i: 'notes', x: 0, y: 22, w: 5, h: 6, minW: 3, minH: 5, static: false },
  ],
  xs: [
    { i: 'metric-total', x: 0, y: 0, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-open', x: 0, y: 2, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-progress', x: 0, y: 4, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-pending', x: 0, y: 6, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'metric-critical', x: 0, y: 8, w: 1, h: 2, minW: 1, minH: 2, static: false },
    { i: 'trends', x: 0, y: 10, w: 1, h: 7, minW: 1, minH: 5, static: false },
    { i: 'status', x: 0, y: 17, w: 1, h: 5, minW: 1, minH: 5, static: false },
    { i: 'queue', x: 0, y: 22, w: 1, h: 8, minW: 1, minH: 6, static: false },
    { i: 'notes', x: 0, y: 30, w: 1, h: 6, minW: 1, minH: 5, static: false },
  ],
}

const legacyMediumDashboardLayout = [
  { i: 'metric-total', x: 0, y: 0, w: 2, h: 2 },
  { i: 'metric-open', x: 2, y: 0, w: 2, h: 2 },
  { i: 'metric-progress', x: 4, y: 0, w: 2, h: 2 },
  { i: 'metric-pending', x: 0, y: 2, w: 3, h: 2 },
  { i: 'metric-critical', x: 3, y: 2, w: 3, h: 2 },
  { i: 'trends', x: 0, y: 4, w: 6, h: 7 },
  { i: 'status', x: 0, y: 11, w: 6, h: 5 },
  { i: 'queue', x: 0, y: 16, w: 6, h: 9 },
  { i: 'notes', x: 0, y: 25, w: 6, h: 7 },
] as const

const legacySmallDashboardLayout = [
  { i: 'metric-total', x: 0, y: 0, w: 1, h: 2 },
  { i: 'metric-open', x: 1, y: 0, w: 1, h: 2 },
  { i: 'metric-progress', x: 0, y: 2, w: 1, h: 2 },
  { i: 'metric-pending', x: 1, y: 2, w: 1, h: 2 },
  { i: 'metric-critical', x: 0, y: 4, w: 2, h: 2 },
  { i: 'trends', x: 0, y: 6, w: 2, h: 7 },
  { i: 'status', x: 0, y: 13, w: 2, h: 5 },
  { i: 'queue', x: 0, y: 18, w: 2, h: 8 },
  { i: 'notes', x: 0, y: 26, w: 2, h: 6 },
] as const

const matchesLegacyMediumDashboardLayout = (layout: readonly LayoutItem[]) =>
  legacyMediumDashboardLayout.every((legacyItem) => {
    const candidate = layout.find((layoutItem) => layoutItem.i === legacyItem.i)
    return (
      candidate?.x === legacyItem.x &&
      candidate?.y === legacyItem.y &&
      candidate?.w === legacyItem.w &&
      candidate?.h === legacyItem.h
    )
  }) && layout.length === dashboardWidgetOrder.length

const matchesLegacySmallDashboardLayout = (layout: readonly LayoutItem[]) =>
  legacySmallDashboardLayout.every((legacyItem) => {
    const candidate = layout.find((layoutItem) => layoutItem.i === legacyItem.i)
    return (
      candidate?.x === legacyItem.x &&
      candidate?.y === legacyItem.y &&
      candidate?.w === legacyItem.w &&
      candidate?.h === legacyItem.h
    )
  }) && layout.length === dashboardWidgetOrder.length

export const mergeDashboardLayouts = (storedLayouts: DashboardLayouts | null) => {
  const breakpoints = Object.keys(defaultDashboardLayouts) as Array<keyof DashboardLayouts>

  return breakpoints.reduce<DashboardLayouts>((merged, breakpoint) => {
    const defaultLayout = defaultDashboardLayouts[breakpoint] ?? []
    const storedLayout = storedLayouts?.[breakpoint] ?? []
    const normalizedStoredLayout =
      (breakpoint === 'md' && matchesLegacyMediumDashboardLayout(storedLayout)) ||
      (breakpoint === 'sm' && matchesLegacySmallDashboardLayout(storedLayout))
        ? []
        : storedLayout
    const storedById = new Map<string, LayoutItem>(
      normalizedStoredLayout.map((layoutItem): [string, LayoutItem] => [layoutItem.i, layoutItem]),
    )

    merged[breakpoint] = defaultLayout.map((defaultItem): LayoutItem => ({
      ...defaultItem,
      ...(storedById.get(defaultItem.i) ?? {}),
      i: defaultItem.i,
      w: Math.max(storedById.get(defaultItem.i)?.w ?? defaultItem.w, defaultItem.minW ?? 1),
      h: Math.max(storedById.get(defaultItem.i)?.h ?? defaultItem.h, defaultItem.minH ?? 1),
      minW: defaultItem.minW,
      minH: defaultItem.minH,
      static: false,
    }))

    return merged
  }, {})
}

export const filterDashboardLayouts = (
  layouts: DashboardLayouts,
  widgetIds: readonly DashboardWidgetId[],
) => {
  const allowedWidgetIds = new Set(widgetIds)
  const breakpoints = Object.keys(layouts) as Array<keyof DashboardLayouts>

  return breakpoints.reduce<DashboardLayouts>((filtered, breakpoint) => {
    filtered[breakpoint] = (layouts[breakpoint] ?? []).filter((layoutItem) =>
      allowedWidgetIds.has(layoutItem.i as DashboardWidgetId),
    )

    return filtered
  }, {})
}
