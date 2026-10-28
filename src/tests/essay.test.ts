import { describe, it, expect } from 'vitest';
import { EssayService } from '../services/ai/essay.service';

describe('Deterministic Essay Vocabulary & Word Count Validation', () => {
  const targetWords = 30;
  const mandatoryVocabulary = ['enjoy', 'practice', 'interesting', 'improve', 'happy', 'free'];

  it('fails validation when word count is below the target requirement', () => {
    const text = 'I enjoy reading books in my free time. It is interesting and makes me happy.';
    const result = EssayService.validateEssayRequirements(text, targetWords, mandatoryVocabulary);

    expect(result.isValid).toBe(false);
    expect(result.errorMessage).toContain('So‘zlar soni yetarli emas');
    expect(result.wordCount).toBeLessThan(targetWords);
  });

  it('detects missing mandatory words and lists them accurately', () => {
    // 35 words, but missing "practice" and "improve"
    const text = `
      In my daily life, I really enjoy traveling and discovering new places.
      It is very interesting to explore different traditions, and it makes me feel genuinely happy.
      Whenever I have free time, I like to visit historical cities and meet wonderful people.
    `;
    const result = EssayService.validateEssayRequirements(text, targetWords, mandatoryVocabulary);

    expect(result.isValid).toBe(false);
    expect(result.missingWords).toContain('practice');
    expect(result.missingWords).toContain('improve');
    expect(result.matchedWords).toContain('enjoy');
    expect(result.matchedWords).toContain('interesting');
    expect(result.matchedWords).toContain('happy');
    expect(result.matchedWords).toContain('free');
  });

  it('matches required words case-insensitively and respects token boundaries without accidental substring matching', () => {
    // Note: "freeze" must NOT match "free"
    const text = `
      The winter cold can freeze everything outside.
      However, people enjoy practicing their sports.
    `;
    const result = EssayService.validateEssayRequirements(text, 10, ['free', 'enjoy']);
    expect(result.missingWords).toContain('free');
    expect(result.matchedWords).toContain('enjoy');
  });

  it('passes validation when all mandatory words and minimum word count are satisfied', () => {
    const text = `
      I really enjoy my hobbies because they make me very happy.
      Every single weekend, I like to practice English speaking with friends.
      It is deeply interesting to learn new words and improve my communication skills.
      During my free hours, learning gives me joy and confidence.
    `;
    const result = EssayService.validateEssayRequirements(text, targetWords, mandatoryVocabulary);

    expect(result.isValid).toBe(true);
    expect(result.wordCount).toBeGreaterThanOrEqual(targetWords);
    expect(result.missingWords).toHaveLength(0);
    expect(result.matchedWords).toEqual(expect.arrayContaining(mandatoryVocabulary));
  });
});
