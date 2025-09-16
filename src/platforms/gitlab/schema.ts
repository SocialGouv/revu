export interface GitlabEvent {
  object_kind: string
  event_type: string
  user: {
    id: number
    name: string
    username: string
    email: string
  }
  project: {
    id: number
    name: string
    description: string
    web_url: string
    git_ssh_url: string
    git_http_url: string
    namespace: string
    visibility_level: number
    path_with_namespace: string
    default_branch: string
    ci_config_path: string
    homepage: string
    url: string
    ssh_url: string
    http_url: string
  }
  repository: {
    name: string
    url: string
    description: string
    homepage: string
  }
}

export interface CommentEvent extends GitlabEvent {
  object_kind: 'note'
  event_type: 'note'
  project_id: number
  object_attributes: {
    id: number
    note: string
    noteable_type: string
    author_id: number
    created_at: string
    updated_at: string
    project_id: number
    attachment: null | string
    line_code: null | string
    commit_id: null | string
    noteable_id: number
    system: boolean
    st_diff: null | string
    url: string
  }
}

export interface MergeRequestEvent extends GitlabEvent {
  object_kind: 'merge_request'
  event_type: 'merge_request'
  object_attributes: {
    id: number
    iiid: number
    target_branch: string
    source_branch: string
    source_project_id: number
    author_id: number
    assignee_ids: number[]
    assignee_id: number | null
    reviewer_ids: number[]
    title: string
    created_at: string
    updated_at: string
    action:
      | 'open'
      | 'close'
      | 'reopen'
      | 'update'
      | 'approved'
      | 'unapproved'
      | 'approval'
      | 'unapproval'
      | 'merge'
    oldrev: string
  }
}
