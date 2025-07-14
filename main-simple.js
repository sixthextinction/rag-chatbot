const readline = require('readline');
const CONFIG = require('./config');
const { OllamaClient } = require('./ollama');
const { initializeVectorStore, storeTopicChunks, listTopics, getTopicStats, topicExists } = require('./vectorstore');
const { researchTopic } = require('./search');
const { createRAGState, setTopic, answerQuestion, clearHistory } = require('./rag');
const { generateTopicId, validateTopic } = require('./utils');
const { clearExpiredCache } = require('./cache');

// chatbot state variables
// 1. Config 
let config = CONFIG;
// 2. Ollama client instance (we'll create/init this in a bit)
let ollama = null;
// 3. Vector context for vector operations. Contains our ChromaDB client (we'll init this in a bit), our custom embedding function, and config from 1.
let vectorContext = null;
// 4. RAG state for managing chatbot state. Contains currentTopic (with an id) and conversationHistory
let ragState = null;
// 5. Readline interface for user input
let rl = null;
// 6. Current phase of the chatbot (TOPIC_INGESTION or CHAT)
let currentPhase = 'TOPIC_INGESTION';
// 7. The current topic being discussed
let currentTopic = null;

// start the chatbot
async function start() {
    try {
        await initialize();
        await showWelcomeMessage();
        await interactionLoop();
    } catch (error) {
        console.error('❌ Chatbot failed to start:', error.message);
        process.exit(1);
    }
}

//----------------------------------------------------------------------------------
// Before doing anything, initialize each part of our chatbot.
async function initialize() {
    console.log('Initializing RAG Chatbot...');

    try {
        // 1. clear expired cache files (if older than expiryDays threshold)
        clearExpiredCache(config.cache.dir, config.cache.expiryDays);

        // 2. initialize Ollama client
        console.log('checking Ollama connection...');
        ollama = new OllamaClient(config);
        const ollamaStatus = await ollama.checkConnection();

        if (!ollamaStatus.connected) {
            throw new Error(`Ollama not connected: ${ollamaStatus.error}`);
        }

        if (ollamaStatus.missingModels.length > 0) {
            console.log(`pulling missing models: ${ollamaStatus.missingModels.join(', ')}`);
            for (const model of ollamaStatus.missingModels) {
                await ollama.pullModel(model);
            }
        }

        // 3. initialize vector store
        vectorContext = await initializeVectorStore(config, ollama);

        // 4. initialize RAG state
        ragState = createRAGState();

        // 5. setup a readline interface for user interaction
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('✅ Initialization complete');
        return true;

    } catch (error) {
        console.error('❌ Initialization failed:', error.message);
        throw error;
    }
}
//----------------------------------------------------------------------------------
// Handlers for each phase of the chatbot
// 1. for research/topic ingestion phase
async function handleTopicIngestion(input) {
    if (!validateTopic(input)) {
        console.log('❌ Invalid topic - please enter a valid topic name (1-100 characters)');
        return;
    }

    const topicId = generateTopicId(input);

    // check if topic already exists
    const exists = await topicExists(vectorContext, topicId);
    if (exists) {
        console.log(`Topic "${input}" already exists - switching to Q&A mode...`);
        await switchToChat(topicId, input);
        return;
    }

    console.log(`\nResearching topic: "${input}"...`);

    try {
        // research the topic
        const researchData = await researchTopic(input, config);

        if (researchData.chunks.length === 0) {
            console.log('❌ No data found for this topic - please try a different topic');
            return;
        }

        // store in vector database
        console.log('Storing knowledge in vector database...');
        await storeTopicChunks(vectorContext, topicId, researchData.chunks);

        console.log(`✅ Research Complete - collected ${researchData.chunks.length} chunks from ${researchData.metadata.sources.length} sources`);

        // small delay to ensure collection is fully available
        await new Promise(resolve => setTimeout(resolve, 1000));

        // switch to chat mode
        console.log('Switching to Q&A mode...');
        await switchToChat(topicId, input);

    } catch (error) {
        console.log(`❌ Research failed: ${error.message}`);
        console.log('Please try a different topic or check your configuration');
    }
}

// 2. for chat phase
async function handleChatQuestion(question) {
    try {
        console.log('\nThinking...');

        const response = await answerQuestion(ragState, vectorContext, ollama, config, question);

        console.log('\n=== ANSWER ===');
        console.log(response.answer);

        if (response.sources.length > 0) {
            console.log('\nSources:');
            response.sources.forEach(source => {
                console.log(`  • ${source}`);
            });
        }
        console.log();

    } catch (error) {
        console.log(`❌ Failed to answer question: ${error.message}`);
        console.log('Please try rephrasing your question');
    }
}

// 3. for special commands (list, stats, switch, clear, back)
async function handleSpecialCommands(input) {
    const [command, ...args] = input.toLowerCase().split(' ');

    switch (command) {
        case 'list':
            await showAvailableTopics();
            return true;

        case 'stats':
            if (args.length > 0) {
                await showTopicStats(args.join(' '));
            } else {
                console.log('❌ Usage: stats <topic_name>');
            }
            return true;

        case 'switch':
            if (args.length > 0) {
                await switchToExistingTopic(args.join(' '));
            } else {
                console.log('❌ Usage: switch <topic_name>');
            }
            return true;

        case 'clear':
            if (ragState) {
                clearHistory(ragState);
                console.log('✅ Conversation history cleared');
            }
            return true;

        case 'back':
            if (currentPhase === 'CHAT') {
                currentPhase = 'TOPIC_INGESTION';
                currentTopic = null;
                console.log('\n=== TOPIC SELECTION MODE ===');
            }
            return true;

        default:
            return false;
    }
}

//----------------------------------------------------------------------------------
// Topic Management Functions - for working with existing topics
// 1. show all available topics (technically optional but is really good QOL)
async function showAvailableTopics() {
    try {
        const topics = await listTopics(vectorContext);

        if (topics.length === 0) {
            console.log('No topics available yet.');
            return;
        }

        console.log('Available topics:');
        for (const topic of topics) {
            const stats = await getTopicStats(vectorContext, topic);
            console.log(`  • ${topic} (${stats.total_chunks} chunks, ${Object.keys(stats.sources).length} sources)`);
        }

    } catch (error) {
        console.error('❌ Failed to list topics:', error.message);
    }
}

// 2. show statistics for a specific topic (SO optional.)
async function showTopicStats(topicName) {
    try {
        const topicId = generateTopicId(topicName);
        const exists = await topicExists(vectorContext, topicId);

        if (!exists) {
            console.log(`❌ Topic "${topicName}" not found`);
            return;
        }

        const stats = await getTopicStats(vectorContext, topicId);

        console.log(`Statistics for "${topicName}":`);
        console.log(`  • Total chunks: ${stats.total_chunks}`);
        console.log(`  • Sources: ${Object.keys(stats.sources).length}`);
        console.log(`  • Chunk types: ${Object.keys(stats.chunk_types).join(', ')}`);
        console.log(`  • Search types: ${Object.keys(stats.search_types).join(', ')}`);

    } catch (error) {
        console.error('❌ Failed to get topic stats:', error.message);
    }
}

// 3. switch to an existing topic for Q&A
async function switchToExistingTopic(topicName) {
    try {
        const topicId = generateTopicId(topicName);
        const exists = await topicExists(vectorContext, topicId);

        if (!exists) {
            console.log(`❌ Topic "${topicName}" not found. Available topics:`);
            await showAvailableTopics();
            return;
        }

        await switchToChat(topicId, topicName);

    } catch (error) {
        console.error('❌ Failed to switch topic:', error.message);
    }
}

// 4. changes the current phase to 'CHAT' (Q&A mode) and sets the current topic
async function switchToChat(topicId, topicName) {
    try {
        await setTopic(ragState, vectorContext, topicId);
        currentPhase = 'CHAT';
        currentTopic = topicName;

        console.log(`\n=== Q&A MODE FOR: ${topicName.toUpperCase()} ===`);
        console.log('Ask me anything about this topic!');
        console.log('Type "back" to return to topic selection');

    } catch (error) {
        console.log(`❌ Failed to switch to chat mode: ${error.message}`);
        console.log(`Debug: attempted to switch to topic ID: "${topicId}"`);

        // try to list available topics for debugging
        try {
            const availableTopics = await listTopics(vectorContext);
            console.log(`Debug: available topics: [${availableTopics.join(', ')}]`);
        } catch (listError) {
            console.log('Debug: failed to list topics for debugging');
        }
    }
}
//----------------------------------------------------------------------------------
// UI & Utility Functions - for user interaction and system management
// 1. the main interaction loop
async function interactionLoop() {
    while (true) {
        try {
            // Step 1: Get user input
            const input = await getUserInput();
            const trimmedInput = input.trim();

            if (!trimmedInput) {
                continue;
            }

            // Step 2: Handle exit commands + special commands (list, stats, switch, clear, back)
            if (['quit', 'exit', 'bye'].includes(trimmedInput.toLowerCase())) {
                console.log('\nGoodbye!');
                break;
            }
            if (await handleSpecialCommands(trimmedInput)) {
                continue;
            }

            // Step 3: Handle interaction based on current phase
            if (currentPhase === 'TOPIC_INGESTION') {
                await handleTopicIngestion(trimmedInput);
            } else if (currentPhase === 'CHAT') {
                await handleChatQuestion(trimmedInput);
            }

        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
            console.log('Please try again or type "quit" to exit');
        }
    }

    cleanup();
}

// 2. get user input with appropriate prompts
function getUserInput() {
    const prompt = currentPhase === 'CHAT'
        ? `\n[${currentTopic}] Your question: ` // if in chat mode, we already have a topic
        : '\nEnter topic to research (or command): '; // if in topic ingestion mode, we need the user to enter a topic

    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

// 3. cleanup resources
function cleanup() {
    if (rl) {
        rl.close();
    }
    console.log('Cleaned up resources');
}

// 4. show welcome message and available topics
async function showWelcomeMessage() {
    console.log('\n=== RAG CHATBOT - TOPIC RESEARCH & Q&A ===');

    // show known topics (if any)
    const availableTopics = await listTopics(vectorContext);
    if (availableTopics.length > 0) {
        console.log('\nknowledge base:');
        for (const topic of availableTopics) {
            const stats = await getTopicStats(vectorContext, topic);
            console.log(`  • ${topic} (${stats.total_chunks} chunks)`);
        }
        console.log('\nyou can research a new topic or ask questions about existing ones');
    } else {
        console.log('\nknowledge base empty - enter a topic name to start researching');
    }

    console.log('\ncommands:');
    console.log('  • enter a topic: research and learn about a topic');
    console.log('  • "list": show all available topics');
    console.log('  • "stats <topic>": show statistics for a topic');
    console.log('  • "switch <topic>": switch to Q&A mode for an existing topic');
    console.log('  • "clear": clear conversation history');
    console.log('  • "quit" or "exit": exit the chatbot');
}

//----------------------------------------------------------------------------------
// start the chatbot if this file is run directly
if (require.main === module) {
    // handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nShutting down gracefully...');
        cleanup();
        process.exit(0);
    });

    // start the chatbot
    start().catch(error => {
        console.error('❌ Chatbot crashed:', error.message);
        process.exit(1);
    });
}

module.exports = {
    start,
    initialize,
    handleTopicIngestion,
    handleChatQuestion,
    switchToChat,
    cleanup
}; 