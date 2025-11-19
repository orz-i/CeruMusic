import { NotifyPlugin, MessagePlugin, DialogPlugin, InputNumber } from 'tdesign-vue-next'
import { LocalUserDetailStore } from '@renderer/store/LocalUserDetail'
import { useSettingsStore } from '@renderer/store/Settings'
import { toRaw, h, ref } from 'vue'
import {
  QUALITY_ORDER,
  getQualityDisplayName,
  buildQualityFormats,
  getHighestQualityType,
  compareQuality,
  type KnownQuality
} from '@common/utils/quality'

interface MusicItem {
  singer: string
  name: string
  albumName: string
  albumId: number
  source: string
  interval: string
  songmid: number
  img: string
  lrc: null | string
  types: Array<{ type: string; size?: string }> | string[]
  _types: Record<string, any>
  typeUrl: Record<string, any>
}

// 创建音质选择弹窗
function createQualityDialog(songInfo: MusicItem, userQuality: string): Promise<string | null> {
  return new Promise((resolve) => {
    // 获取歌曲支持的音质列表
    // 处理 types 可能是 string[] 的情况
    const types = songInfo.types || []
    let normalizedTypes: Array<{ type: string; size?: string }>
    if (Array.isArray(types) && types.length > 0) {
      if (typeof types[0] === 'string') {
        // 如果是 string[]，转换为 { type: string }[]
        normalizedTypes = (types as string[]).map((t) => ({ type: t }))
      } else {
        // 如果是 { type: string; size?: string }[]
        normalizedTypes = types as Array<{ type: string; size?: string }>
      }
    } else {
      normalizedTypes = []
    }
    const availableQualities = buildQualityFormats(normalizedTypes)
    // 展示全部音质，但对超出用户最高音质的项做禁用呈现
    const userMaxIndex = QUALITY_ORDER.indexOf(userQuality as KnownQuality)
    const qualityOptions = [...availableQualities]

    // 按音质优先级排序（高→低）
    qualityOptions.sort((a, b) => compareQuality(a.type, b.type))

    const dialog = DialogPlugin.confirm({
      header: '选择下载音质(可滚动)',
      width: 400,
      placement: 'center',
      body: () =>
        h(
          'div',
          {
            class: 'quality-selector'
          },
          [
            h(
              'div',
              {
                class: 'quality-list',
                style: {
                  maxHeight:
                    'max(calc(calc(70vh - 2 * var(--td-comp-paddingTB-xxl)) - 24px - 32px - 32px),100px)',
                  overflow: 'auto',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none'
                }
              },
              qualityOptions.map((quality) => {
                const idx = QUALITY_ORDER.indexOf(quality.type as KnownQuality)
                const disabled = userMaxIndex !== -1 && idx !== -1 && idx < userMaxIndex
                return h(
                  'div',
                  {
                    key: quality.type,
                    class: 'quality-item',
                    title: disabled ? '超出你的最高音质设置，已禁用' : undefined,
                    style: {
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      margin: '8px 0',
                      border: '1px solid ' + (disabled ? '#f0f0f0' : '#e7e7e7'),
                      borderRadius: '6px',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s ease',
                      backgroundColor:
                        quality.type === userQuality ? (disabled ? '#f5faff' : '#e6f7ff') : '#fff',
                      opacity: disabled ? 0.55 : 1
                    },
                    onClick: () => {
                      if (disabled) return
                      dialog.destroy()
                      resolve(quality.type)
                    },
                    onMouseenter: (e: MouseEvent) => {
                      if (disabled) return
                      const target = e.target as HTMLElement
                      target.style.backgroundColor = '#f0f9ff'
                      target.style.borderColor = '#1890ff'
                    },
                    onMouseleave: (e: MouseEvent) => {
                      const target = e.target as HTMLElement
                      if (disabled) {
                        target.style.backgroundColor =
                          quality.type === userQuality ? '#f5faff' : '#fff'
                        target.style.borderColor = '#f0f0f0'
                        return
                      }
                      target.style.backgroundColor =
                        quality.type === userQuality ? '#e6f7ff' : '#fff'
                      target.style.borderColor = '#e7e7e7'
                    }
                  },
                  [
                    h('div', { class: 'quality-info' }, [
                      h(
                        'div',
                        {
                          style: {
                            fontWeight: '500',
                            fontSize: '14px',
                            color:
                              quality.type === userQuality
                                ? disabled
                                  ? '#8fbfff'
                                  : '#1890ff'
                                : '#333'
                          }
                        },
                        getQualityDisplayName(quality.type)
                      ),
                      h(
                        'div',
                        {
                          style: {
                            fontSize: '12px',
                            color: disabled ? '#bbb' : '#999',
                            marginTop: '2px'
                          }
                        },
                        quality.type.toUpperCase()
                      )
                    ]),
                    h(
                      'div',
                      {
                        class: 'quality-size',
                        style: {
                          fontSize: '12px',
                          color: disabled ? '#999' : '#666',
                          fontWeight: '500'
                        }
                      },
                      quality.size
                    )
                  ]
                )
              })
            )
          ]
        ),
      confirmBtn: null,
      cancelBtn: null,
      footer: false
    })
  })
}

/**
 * 自动选择最高音质下载单首歌曲（不弹出音质选择对话框）
 */
async function downloadSingleSongWithHighestQuality(
  songInfo: MusicItem,
  showProgress = true
): Promise<{ success: boolean; message: string }> {
  try {
    console.log('开始下载', toRaw(songInfo))
    const LocalUserDetail = LocalUserDetailStore()
    const userQuality = LocalUserDetail.userSource.quality as string
    const settingsStore = useSettingsStore()

    // 获取歌词
    const { crlyric, lyric } = await window.api.music.requestSdk('getLyric', {
      source: toRaw(songInfo.source),
      songInfo: toRaw(songInfo) as any
    })
    songInfo.lrc = crlyric && songInfo.source !== 'tx' ? crlyric : lyric

    // 自动选择最高音质
    const songMaxQuality = getHighestQualityType(songInfo.types)
    let quality = songMaxQuality || userQuality

    // 如果歌曲的最高音质超出用户设置的最高音质，则使用用户设置的最高音质
    const userMaxIndex = QUALITY_ORDER.indexOf(userQuality as KnownQuality)
    const selectedIndex = QUALITY_ORDER.indexOf(quality as KnownQuality)
    if (userMaxIndex !== -1 && selectedIndex !== -1 && selectedIndex < userMaxIndex) {
      quality = userQuality
    }

    console.log(`使用音质下载: ${quality} - ${getQualityDisplayName(quality)}`)

    if (showProgress) {
      MessagePlugin.loading(`正在下载: ${songInfo.name}`)
    }

    const result = await window.api.music.requestSdk('downloadSingleSong', {
      pluginId: LocalUserDetail.userSource.pluginId?.toString() || '',
      source: songInfo.source,
      quality,
      songInfo: toRaw(songInfo) as any,
      tagWriteOptions: toRaw(settingsStore.settings.tagWriteOptions),
      isCache: true
    })

    if (!Object.hasOwn(result, 'path')) {
      return { success: false, message: result.message || '下载失败' }
    } else {
      return { success: true, message: result.message || '下载成功' }
    }
  } catch (error: any) {
    console.error('下载失败:', error)
    return {
      success: false,
      message: error.message?.includes('歌曲正在') ? '歌曲正在下载中' : error.message || '未知错误'
    }
  }
}

async function downloadSingleSong(songInfo: MusicItem): Promise<void> {
  try {
    console.log('开始下载', toRaw(songInfo))
    const LocalUserDetail = LocalUserDetailStore()
    const userQuality = LocalUserDetail.userSource.quality as string
    const settingsStore = useSettingsStore()

    // 获取歌词
    const { crlyric, lyric } = await window.api.music.requestSdk('getLyric', {
      source: toRaw(songInfo.source),
      songInfo: toRaw(songInfo) as any
    })
    console.log(songInfo)
    songInfo.lrc = crlyric && songInfo.source !== 'tx' ? crlyric : lyric

    // 显示音质选择弹窗
    const selectedQuality = await createQualityDialog(songInfo, userQuality)

    // 如果用户取消选择，直接返回
    if (!selectedQuality) {
      return
    }

    let quality = selectedQuality as string

    // 检查选择的音质是否超出歌曲支持的最高音质
    const songMaxQuality = getHighestQualityType(songInfo.types)
    if (
      songMaxQuality &&
      QUALITY_ORDER.indexOf(quality as KnownQuality) <
        QUALITY_ORDER.indexOf(songMaxQuality as KnownQuality)
    ) {
      quality = songMaxQuality
      MessagePlugin.warning(`所选音质不可用，已自动调整为: ${getQualityDisplayName(quality)}`)
    }

    console.log(`使用音质下载: ${quality} - ${getQualityDisplayName(quality)}`)
    const tip = MessagePlugin.success('开始下载歌曲：' + songInfo.name)

    const result = await window.api.music.requestSdk('downloadSingleSong', {
      pluginId: LocalUserDetail.userSource.pluginId?.toString() || '',
      source: songInfo.source,
      quality,
      songInfo: toRaw(songInfo) as any,
      tagWriteOptions: toRaw(settingsStore.settings.tagWriteOptions),
      isCache: true
    })

    ;(await tip).close()

    if (!Object.hasOwn(result, 'path')) {
      MessagePlugin.info(result.message)
    } else {
      await NotifyPlugin.success({
        title: '下载成功',
        content: `${result.message} 保存位置: ${result.path}`
      })
    }
  } catch (error: any) {
    console.error('下载失败:', error)
    await NotifyPlugin.error({
      title: '下载失败',
      content: `${error.message.includes('歌曲正在') ? '歌曲正在下载中' : '未知错误'}`
    })
  }
}

/**
 * 批量下载歌曲列表，自动选择最高音质，依次下载
 * @param songs 歌曲列表
 */
async function downloadAllSongs(
  songs: Array<{
    singer: string
    name: string
    albumName: string
    albumId: number
    source: string
    interval: string
    songmid: number
    img: string
    lrc: null | string
    types: Array<{ type: string; size?: string }> | string[]
    _types: Record<string, any>
    typeUrl: Record<string, any>
  }>
): Promise<void> {
  if (songs.length === 0) {
    MessagePlugin.warning('歌单为空，无法下载')
    return
  }

  // 使用 ref 来管理间隔时间输入框的值
  const intervalValue = ref(1000)

  const dialog = DialogPlugin.confirm({
    header: '全部下载设置',
    width: 450,
    placement: 'center',
    body: () =>
      h('div', { style: { padding: '8px 0' } }, [
        h('div', { style: { marginBottom: '16px', fontSize: '14px', color: '#333' } }, [
          `确定要下载歌单中的 ${songs.length} 首歌曲吗？将自动选择最高音质，依次下载。`
        ]),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
          h('label', { style: { fontSize: '14px', color: '#333', whiteSpace: 'nowrap' } }, '下载间隔时间(毫秒):'),
          h(InputNumber, {
            modelValue: intervalValue.value,
            'onUpdate:modelValue': (val: number) => {
              intervalValue.value = val || 1000
            },
            min: 100,
            max: 10000,
            step: 100,
            style: { flex: 1 }
          })
        ]),
        h('div', { style: { marginTop: '8px', fontSize: '12px', color: '#999' } }, [
          '建议值: 500-2000ms，避免请求过于频繁'
        ])
      ]),
    confirmBtn: '开始下载',
    cancelBtn: '取消',
    onConfirm: async () => {
      const interval = intervalValue.value || 1000
      // 验证间隔时间范围
      if (interval < 100 || interval > 10000) {
        MessagePlugin.warning('间隔时间应在 100-10000 毫秒之间')
        return
      }
      dialog.destroy()
      await startBatchDownload(songs, interval)
    },
    onCancel: () => {
      dialog.destroy()
    }
  })
}

/**
 * 执行批量下载
 * @param songs 歌曲列表
 * @param interval 下载间隔时间（毫秒），默认1000ms（1秒）
 */
async function startBatchDownload(
  songs: Array<{
    singer: string
    name: string
    albumName: string
    albumId: number
    source: string
    interval: string
    songmid: number
    img: string
    lrc: null | string
    types: Array<{ type: string; size?: string }> | string[]
    _types: Record<string, any>
    typeUrl: Record<string, any>
  }>,
  interval: number = 1000
): Promise<void> {
  const total = songs.length
  let successCount = 0
  let failCount = 0
  const failedSongs: string[] = []

  let loadingTipPromise: Promise<{ close: () => void }> | null = null

  const updateProgress = (current: number, songName: string) => {
    // 关闭旧的 loading
    if (loadingTipPromise) {
      loadingTipPromise.then((tip) => tip.close()).catch(() => {})
    }
    // 创建新的 loading
    loadingTipPromise = MessagePlugin.loading(
      `正在下载 (${current}/${total}): ${songName}`,
      0
    )
  }

  try {
    // 初始 loading
    loadingTipPromise = MessagePlugin.loading(`准备下载 ${total} 首歌曲...`, 0)

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i]
      const current = i + 1

      // 更新进度提示
      updateProgress(current, `${song.name} - ${song.singer}`)

      // 下载单首歌曲（不显示单独的进度提示）
      const result = await downloadSingleSongWithHighestQuality(song, false)

      if (result.success) {
        successCount++
      } else {
        failCount++
        failedSongs.push(`${song.name} - ${song.singer}`)
        console.warn(`下载失败: ${song.name}`, result.message)
      }

      // 添加间隔延迟，避免请求过快
      if (i < songs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }

    // 关闭加载提示
    if (loadingTipPromise) {
      ;(await loadingTipPromise).close()
    }

    // 显示下载结果
    if (failCount === 0) {
      await NotifyPlugin.success({
        title: '下载完成',
        content: `成功下载 ${successCount} 首歌曲`
      })
    } else {
      await NotifyPlugin.warning({
        title: '下载完成',
        content: `成功: ${successCount} 首，失败: ${failCount} 首${
          failedSongs.length > 0 ? `\n失败歌曲: ${failedSongs.slice(0, 5).join('、')}${failedSongs.length > 5 ? '...' : ''}` : ''
        }`
      })
    }
  } catch (error: any) {
    if (loadingTipPromise) {
      try {
        ;(await loadingTipPromise).close()
      } catch (e) {
        // 忽略关闭错误
      }
    }
    console.error('批量下载出错:', error)
    await NotifyPlugin.error({
      title: '下载出错',
      content: error.message || '未知错误'
    })
  }
}

export { downloadSingleSong, downloadSingleSongWithHighestQuality, downloadAllSongs }
