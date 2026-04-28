import { computeFileSha256Hex, uploadFileWithProgress } from '@/lib/ipfs-upload'

jest.mock('@/config/env', () => ({
  getConfig: () => ({
    apiUrl: 'https://api.example.com',
  }),
}))

class MockXMLHttpRequest {
  static queue: Array<(xhr: MockXMLHttpRequest) => void> = []
  upload = { onprogress: null as ((event: ProgressEvent<EventTarget> & { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: null | (() => void) = null
  onerror: null | (() => void) = null
  status = 0
  responseText = ''

  open = jest.fn()
  send = jest.fn(() => {
    const run = MockXMLHttpRequest.queue.shift()
    if (run) run(this)
  })
  abort = jest.fn()
}

describe('ipfs-upload', () => {
  const originalXHR = global.XMLHttpRequest

  beforeEach(() => {
    MockXMLHttpRequest.queue = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.XMLHttpRequest = MockXMLHttpRequest as any
  })

  afterAll(() => {
    global.XMLHttpRequest = originalXHR
  })

  it('computes SHA-256 hash using Web Crypto API', async () => {
    const file = new File([new TextEncoder().encode('hello')], 'hello.txt', { type: 'text/plain' })
    const hash = await computeFileSha256Hex(file)
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })

  it('throws when server hash does not match expected client hash', async () => {
    MockXMLHttpRequest.queue.push((xhr) => {
      xhr.status = 200
      xhr.responseText = JSON.stringify({
        gatewayUrls: ['https://ipfs.io/ipfs/bafy123'],
        contentSha256Hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      })
      xhr.onload?.()
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'sample.png', { type: 'image/png' })
    await expect(
      uploadFileWithProgress(file, undefined, undefined, 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    ).rejects.toThrow('Uploaded content hash mismatch')
  })

  it('retries and fails with network error', async () => {
    MockXMLHttpRequest.queue.push((xhr) => xhr.onerror?.())
    MockXMLHttpRequest.queue.push((xhr) => xhr.onerror?.())

    const file = new File([new Uint8Array([1, 2, 3])], 'sample.png', { type: 'image/png' })
    await expect(uploadFileWithProgress(file, undefined, undefined, 2)).rejects.toThrow(
      'Network error during upload',
    )
  })
})
