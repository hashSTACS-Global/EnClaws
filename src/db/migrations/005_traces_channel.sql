-- Add channel column to llm_interaction_traces for reliable platform/channel tracking
ALTER TABLE llm_interaction_traces ADD COLUMN channel TEXT;
