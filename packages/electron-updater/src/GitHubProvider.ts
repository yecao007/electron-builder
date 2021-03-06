import { HttpError, request } from "electron-builder-http"
import { CancellationToken } from "electron-builder-http/out/CancellationToken"
import { GithubOptions, githubUrl, UpdateInfo } from "electron-builder-http/out/publishOptions"
import { RequestOptions } from "http"
import * as path from "path"
import { parse as parseUrl } from "url"
import { FileInfo, formatUrl, getChannelFilename, getCurrentPlatform, getDefaultChannelName, Provider } from "./api"
import { validateUpdateInfo } from "./GenericProvider"

export abstract class BaseGitHubProvider<T extends UpdateInfo> extends Provider<T> {
  // so, we don't need to parse port (because node http doesn't support host as url does)
  protected readonly baseUrl: RequestOptions
  
  constructor(protected readonly options: GithubOptions, baseHost: string) {
    super()

    const baseUrl = parseUrl(`${options.protocol || "https"}://${options.host || baseHost}`)
    this.baseUrl = {
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port: <any>baseUrl.port,
    }
  }
}

export class GitHubProvider extends BaseGitHubProvider<UpdateInfo> {
  constructor(protected readonly options: GithubOptions) {
    super(options, "github.com")
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const basePath = this.basePath
    const cancellationToken = new CancellationToken()
    const version = await this.getLatestVersionString(basePath, cancellationToken)
    let result: any
    const channelFile = getChannelFilename(getDefaultChannelName())
    const requestOptions = Object.assign({path: this.getBaseDownloadPath(version, channelFile), headers: this.requestHeaders || undefined}, this.baseUrl)
    try {
      result = await request<UpdateInfo>(requestOptions, cancellationToken)
    }
    catch (e) {
      if (e instanceof HttpError && e.response.statusCode === 404) {
        throw new Error(`Cannot find ${channelFile} in the latest release artifacts (${formatUrl(<any>requestOptions)}): ${e.stack || e.message}`)
      }
      throw e
    }

    validateUpdateInfo(result)
    if (getCurrentPlatform() === "darwin") {
      result.releaseJsonUrl = `${githubUrl(this.options)}/${requestOptions.path}`
    }
    return result
  }

  private async getLatestVersionString(basePath: string, cancellationToken: CancellationToken): Promise<string> {
    const requestOptions: RequestOptions = Object.assign({
      path: `${basePath}/latest`,
      headers: Object.assign({Accept: "application/json"}, this.requestHeaders)
    }, this.baseUrl)
    try {
      // do not use API to avoid limit
      const releaseInfo = (await request<GithubReleaseInfo>(requestOptions, cancellationToken))
      return (releaseInfo.tag_name.startsWith("v")) ? releaseInfo.tag_name.substring(1) : releaseInfo.tag_name
    }
    catch (e) {
      throw new Error(`Unable to find latest version on GitHub (${formatUrl(<any>requestOptions)}), please ensure a production release exists: ${e.stack || e.message}`)
    }
  }

  private get basePath() {
    return `/${this.options.owner}/${this.options.repo}/releases`
  }

  async getUpdateFile(versionInfo: UpdateInfo): Promise<FileInfo> {
    if (getCurrentPlatform() === "darwin") {
      return <any>versionInfo
    }

    // space is not supported on GitHub
    const name = versionInfo.githubArtifactName || path.posix.basename(versionInfo.path).replace(/ /g, "-")
    return {
      name: name,
      url: formatUrl(Object.assign({path: this.getBaseDownloadPath(versionInfo.version, name)}, this.baseUrl)),
      sha2: versionInfo.sha2,
    }
  }
  
  private getBaseDownloadPath(version: string, fileName: string) {
    return `${this.basePath}/download/${this.options.vPrefixedTagName === false ? "" : "v"}${version}/${fileName}`
  }
}

interface GithubReleaseInfo {
  readonly tag_name: string
}