import {Module} from '@nestjs/common';
import {AuthModule} from '../auth/auth.module';
import {RuntimeModule} from '../runtime/runtime.module';
import {OperationsController} from './operations.controller';
import {OperationsService} from './operations.service';

@Module({imports: [AuthModule, RuntimeModule], controllers: [OperationsController], providers: [OperationsService]})
export class OperationsModule {}
