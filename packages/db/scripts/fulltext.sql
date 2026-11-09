-- AgentPM 可选：为 MySQL 8 启用 ngram 全文索引（对中文友好）。
-- 在目标库执行后，将 .env 中 FULLTEXT_ENABLED 置 1 并重启 API。
-- 未执行时系统自动回退到 LIKE 检索，功能不受影响。

ALTER TABLE `Issue` ADD FULLTEXT INDEX `ft_issue_text` (`title`, `description`) WITH PARSER ngram;
