use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub system_prompt: String,
    pub user_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse>;
}

#[derive(Debug, Default)]
pub struct DisabledProvider;

#[async_trait]
impl LlmProvider for DisabledProvider {
    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
        Ok(ChatResponse {
            content: "大模型尚未配置。本版本会优先执行固定 workflow；开放问题会在后续 provider 接入后启用。".to_string(),
        })
    }
}
