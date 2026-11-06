import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class ChatDto {
  @ApiProperty({
    example: 'user-a',
    maxLength: 128,
    pattern: '^[A-Za-z0-9_.@:-]+$',
    description: 'Идентификатор пользователя. Регистр значим: «Alice» и «alice» являются разными пользователями.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_.@:-]+$/, { message: 'user_id contains forbidden characters' })
  @MaxLength(128)
  user_id!: string;

  @ApiProperty({ example: 'Я предпочитаю чай', maxLength: 4000, description: 'Сообщение пользователя' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  // Символ замены означает, что тело пришло не в UTF-8, например из curl в консоли Windows.
  @Matches(/^[^�]*$/, { message: 'message must be valid UTF-8' })
  @MaxLength(4000)
  message!: string;
}
